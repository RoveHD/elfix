# Videoerkennung durch DYNEX

Die Windows-App kann DYNEX automatisch ihre tatsächlich beobachteten Medienverbindungen melden. Dadurch müssen verschlüsselte, wechselnde Hoster nicht anhand ihres Namens geraten werden. Die Integration muss in ELFIX und DYNEX enthalten sein; eine bereits laufende ältere Installation bekommt sie nicht durch eine Einstellung.

Es ist keine Kopplung, Passwort- oder Proxy-Einrichtung nötig. ELFIX meldet nur Server-IP, Port und eigene Prozess-IDs über eine lokale Windows-Benutzer-Pipe. Video-URLs, Titel, Cookies und Inhalte bleiben in ELFIX. Die Wiedergabe hängt nicht von DYNEX ab.

Erfolgreiche Video-/HLS-/DASH-Antworten und von Chromium erkannte Medien liefern Hinweise. Normale Webseiten, Updates, Fehler, Dateianhänge und bekannte Downloads erzeugen keine neuen Medienhinweise. Die bisherigen Adblock-, Cookie-, CORS- und Watchparty-Abläufe bleiben erhalten. Die bestehenden WebRequest-Horcher werden erweitert, nicht durch einen zweiten konkurrierenden Response-Horcher ersetzt.

DYNEX prüft die tatsächliche Client-PID, Benutzer, Programmdatei, Prozessstart und aktuelle Socket-Zuordnung. Die markierten Pakete erhalten AF41 unterhalb von Spielen und Sprache. Es gibt weiterhin keine Bandbreitendrosselung. Wenn mehrere ELFIX-Anfragen exakt denselben Server-Endpunkt oder eine HTTP/2-/HTTP/3-Verbindung teilen, ist keine Trennung der einzelnen verschlüsselten Anfragen möglich. Andere Programme erhalten keine Freigabe.

Prüfen im Verzeichnis `StreamingBrowserElectron`:

```powershell
node tests/dynexvideotest.js
electron tests/dynexvideo-electrontest.js
```

Der erste Test verwendet eine kontrollierte Uhr und simulierte Pipe-Ereignisse. Der zweite verwendet echte Chromium-Anfragen an lokale Testserver und eine echte isolierte Windows-Pipe, ohne sichtbare Fenster oder Benutzerprofile. Mit `DYNEX_MEDIA_TEST_CERT` und `DYNEX_MEDIA_TEST_KEY` können isolierte HTTPS-Testzertifikate verwendet werden; nur die lokale Testsitzung akzeptiert dieses Zertifikat. Produktionssitzungen werden nicht verändert.
