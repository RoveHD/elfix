# Watchparty auf PC und USB-Handy pruefen

## Drei lokale Desktop-Instanzen

`npm run test:watchparty-three-pc` startet drei vollstaendige Electron-Prozesse
mit getrennten Profilen und einem isolierten lokalen Relay. Die produktiven
Main-, Preload-, Renderer- und Playerpfade bleiben aktiv. S.to-Seiten fuer
„Avatar - Die sieben Häfen“ und seekbare Medien werden lokal nachgebildet;
es wird keine Folge heruntergeladen. Die drei Anbieter verwenden
`serienstream.to`, `serienstream.cx` und die bisherige Standard-IP.

Geprueft werden die gemeinsame Mitgliedschaft und Teilnehmerleisten,
Synchronisieren, Play/Pause durch Host und Gast sowie der gemeinsame
Folgenwechsel mit absichtlich zurueckgehaltenen Mediendaten des dritten PCs.
Das ersetzt keinen Netzwerktest mit drei physischen PCs oder einen Live-Test
der externen Hoster. Bei Fehlern nennt der Test den temporaeren Diagnoseordner.

## PC und echtes Android-Geraet

Der Test verwendet den echten Electron-Renderer samt Preload und den nativen
Media3-Player der Debug-APK. Beide verbinden sich ueber die Produktionsmodule
mit einem lokalen, isolierten Relay. Die bestehende Release-App und ihre
Watchparty-Raeume werden dabei nicht verwendet.

Voraussetzungen: ein per USB-Debugging freigegebenes Android-Handy, installierte
Debug-APK und mindestens 50 Sekunden langes, seekbares MP4-Testvideo. Der
Debug-Endpunkt ist durch `android.permission.DUMP` auf die ADB-Shell begrenzt.

Aus `StreamingBrowserElectron`:

```powershell
# Optional: ein eigenes Video mit sichtbarem Bildzaehler erzeugen.
node node_modules/electron/cli.js tests/watchpartyvideo-fixture.js
ffmpeg -i ../build/watchparty-fixture.webm -c:v libx264 -pix_fmt yuv420p -r 25 -g 25 -movflags +faststart -an ../build/watchparty-fixture.mp4

# Standardquelle: ../build/watchparty-fixture.mp4
# Optional bei anderer ADB-Installation: $env:ADB = '.../adb.exe'
node node_modules/electron/cli.js tests/watchpartygeraetekoordinator.js
```

Eine andere Quelle kann mit `ELFIX_WATCHPARTY_VIDEO` angegeben werden;
`ELFIX_WATCHPARTY_OUTPUT` setzt den Ergebnisordner. Fuer die Bruchteile von
Millisekunden ebenfalls mit `-r 24000/1001 -g 24` konvertieren und pruefen.

Die Pruefungen umfassen:

- Wiederholtes Pause/Play von PC und Handy, mit echten Android-Medientasten.
- Identische dargestellte Frame-PTS (bis auf 2 Mikrosekunden Rundung).
- Pausenpositionen innerhalb von 2 ms und keine Rueckspruenge auf alte Starts.
- Gemeinsame Wiedergabe mit maximal 80 ms gemessener Zeitachsenabweichung.
- Abbruch eines geplanten Starts und einer noch wartenden Bereitschaft.
- Keine Wiederaufnahme durch die veraltete Bereitmeldung eines abgebrochenen Starts.

`build/watchparty-device/report.json` enthaelt die Einzelmessungen. Zu jeder
Pause werden PC- und Handy-Screenshots gespeichert. Die Zeitachsenmessung
beruecksichtigt unterschiedliche Geraeteuhren anhand der kuerzesten gemessenen
USB-Telemetrielaufzeit; sie ist keine Messung der physischen Display-Latenz.

Der native Einzeltest laeuft nach Installation der Android-Test-APK mit:

```powershell
adb -d shell am instrument -w -e class local.elflix.android.WatchpartyGeraeteTest local.elflix.android.debug.test/androidx.test.runner.AndroidJUnitRunner
```

Die normalen Regressionspruefungen laufen mit `node tests/run.js`. Einzelne
Suiten lassen sich als Argument angeben, etwa `node tests/run.js synctest
watchpartyvorbereitungtest genautest`.
