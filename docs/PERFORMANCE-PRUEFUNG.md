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

Die großen Cache-Schreibvorgänge laufen derzeit im Electron-Hauptprozess (`src/main.js`, `saveTasteCacheSoon`, `metadatenSpeichernSoon`). Die Verzögerung von 1,5 beziehungsweise 2 Sekunden bündelt Aufträge, macht das anschließende Serialisieren und Schreiben aber nicht asynchron. Das kann die native Fensterbedienung unterbrechen. Ein konkreter Nachweis, dass genau diese Vorgänge das gemeldete Miniplayer-Ruckeln auslösen, steht aus.

## Weitere sinnvolle Verbesserungen

1. **Cache-Arbeit aus dem Hauptprozess verlagern.** Serialisierung und Schreiben getrennt messen; nur `fs.promises.writeFile` beseitigt die JSON-Kosten nicht. Schreibaufträge zusammenfassen, ältere Stände nicht über neuere schreiben lassen und Dateien atomar ersetzen. Mit Ereignisschleifen-Latenz während des Speicherns sowie Wiederherstellung nach Schreibfehlern prüfen.
2. **Android-Listen mit begrenzter Zahl sichtbarer Ansichten.** `MainActivity.entdeckungKartenAnhaengen` hängt weitere Karten an; die Listenansicht erzeugt alle Einträge in einem Durchlauf. Die Bildverwaltung entlastet Bitmaps, aber nicht die wachsende Zahl von Views. Recycling oder kleine Aufbauetappen können große Bibliotheken und längeres Scrollen verbessern. Vorher/nachher mit 50, 200 und 500 Einträgen auf Handy und TV messen.
3. **Veraltete Suchen abbrechen und identische Suchen kurz cachen.** Desktop-`searchAllProviders`/`searchProvider` lässt alte Provider-Abfragen weiterlaufen; die Oberfläche verhindert vor allem die Anzeige alter Ergebnisse. Abbruch bis in den Netzwerkabruf weiterreichen und einen begrenzten Cache pro Anbieter und Suchtext verwenden. Langsame Antworten, schnelle Suchwechsel und die Zahl der Abrufe testen.
4. **Watchparty-Ersatzabfrage bei zuverlässigen Seitenmeldungen aussetzen.** `meldeWatchpartyStand` liest die Anbieteransicht regelmäßig erneut aus. Den Ersatzweg erst bei ausbleibenden Meldungen aktivieren; Wiederaufnahme und unterschiedliche Hoster müssen weiter funktionieren. Das ist ein Codebefund, keine bereits gemessene Einsparung.

Abgesehen vom gezielten Aufschub der optionalen Cache-Ablage während des Miniplayers sind diese weitergehenden Vorschläge nicht implementiert. Insbesondere Geräteabgleich und Watchparty dürfen durch Performance-Änderungen keine Zustände verlieren.

## Branch-Bereinigung

19 alte lokale Branches entfernt: 17 vollständig in `main` enthaltene Arbeitsbranches, ein bereits patchgleich integrierter Sicherungsbranch und ein überholter Player-Prototyp. Die beiden zuletzt genannten Branch-Spitzen sind vorab in `build/history-perf/obsolete-branches-20260908.bundle` gesichert; `git bundle verify` war erfolgreich. Die Ausgangsliste liegt daneben in `branches-before-cleanup.txt`. Das Bundle benötigt die im Repository bereits vorhandene gemeinsame Historie.

Auf GitHub wurde `direkt-alles` nach Prüfung seiner vollständigen Integration entfernt. `main` und die fünf Branches zu den offenen Dependabot-PRs #11–15 bleiben erhalten. Lokal verbleiben `main` und `codex/player-performance` für die hier beschriebenen neuen Änderungen.
