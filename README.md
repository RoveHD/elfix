# ELFIX

ELFIX ist ein kompakter Streaming-Browser fuer Desktop und Android/Android TV. Die App buendelt konfigurierbare Anbieter, globale Direktsuche, Favoriten, Anbieter-Wechsel, Adblock-/Popup-Blocking und eine moderne Startseite.

## Features

- Windows-App mit Chromium-Webviews und installierbarem Setup
- Android/Android-TV-App mit Touch-, D-Pad- und Mausmodus
- Anbieter-Verwaltung fuer AniWorld, S.to, Filmo und eigene Provider
- Globale Suche mit Anbieter-spezifischen Such-URLs und Schreibweisen wie `spiderman`/`spider-man`
- Favoriten mit Anbieter-spezifischer Bild-Erkennung und Fortschrittslogik
- Startseiten-Reihe "Empfohlen fuer dich": Vorschlaege aus den Genres des Verlaufs und den Aehnlichkeits-Listen der Anbieter
- Watchparty: mehrere Geraete teilen ihren Weiterschauen-Fortschritt ueber ein eigenes Relay
- Automatische Updates ueber GitHub Releases fuer die installierte Windows-Version
- Settings mit Version, Update-Status und Fortschrittsbalken

## Watchparty

Mehrere Geraete koennen ihren Weiterschauen-Fortschritt teilen: wer weiterschaut,
aktualisiert die Liste bei allen anderen im selben Raum. Uebertragen wird nur der
Fortschritt (Titel, Adresse, Folge, Position) - die Wiedergabe laeuft auf jedem
Geraet fuer sich.

Dafuer braucht es das Relay aus `sync-server/`. Es haelt keine Daten auf der
Platte, kennt keine Konten und merkt sich nur den letzten Stand je Titel im
Arbeitsspeicher:

```bash
cd sync-server
npm ci
npm start
```

Der Server hoert auf `PORT` (Standard 8787) und laeuft unveraendert auf den
ueblichen Free-Tier-Hostern.

### Dauerbetrieb unter Linux (z. B. Mint) mit Cloudflare Tunnel

Node muss mindestens Version 18 sein - Mint 21 liefert noch 12.22 mit, das
reicht nicht:

```bash
node -v || curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo mkdir -p /opt/elfix-watchparty
sudo cp -r sync-server/* /opt/elfix-watchparty/
cd /opt/elfix-watchparty && npm ci --omit=dev
```

Als Dienst einrichten (Benutzer und Pfad in der Datei anpassen):

```bash
sudo cp /opt/elfix-watchparty/elfix-watchparty.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now elfix-watchparty
curl http://localhost:8787/health
```

Im Cloudflare Tunnel einen Public Hostname anlegen, der auf den lokalen Port
zeigt - entweder im Dashboard (*Service: HTTP*, *URL: localhost:8787*) oder in
der `config.yml`:

```yaml
ingress:
  - hostname: watchparty.deine-domain.tld
    service: http://localhost:8787
  - service: http_status:404
```

WebSockets muessen in Cloudflare aktiv sein (*Network > WebSockets*, im
Normalfall schon an). Cloudflare kappt stille Verbindungen nach etwa 100
Sekunden; der Server sendet alle 30 Sekunden einen Ping und haelt sie damit
offen. In der App wird dann `wss://watchparty.deine-domain.tld` eingetragen.

Achtung: Der Raumcode ist der einzige Zugangsschutz. Cloudflare Access davor zu
setzen funktioniert nicht ohne Weiteres, weil die App keinen Browser-Login
durchlaufen kann - also einen langen, nicht zu erratenden Code waehlen.

Danach in der App unter *Einstellungen > Watchparty* eintragen:

- **Server-Adresse**: `wss://dein-relay.example.com` (`https://` wird automatisch
  zu `wss://`)
- **Raumcode**: derselbe Code auf allen Geraeten. Wer den Code kennt, ist im
  Raum - also nicht zu einfach waehlen
- **Name dieses Geraets**: nur zur Anzeige

Ein Geraet, das spaeter dazukommt, bekommt den bekannten Stand des Raums
nachgereicht. Ein aelterer Stand ueberschreibt nie einen neueren.

## Windows Build

```powershell
cd StreamingBrowserElectron
npm ci
npm run dist
```

Die gebauten Dateien liegen danach unter:

```text
StreamingBrowserElectron/dist/
```

Der Installer heisst nach aktuellem Schema:

```text
ELFIX-Setup-<version>-x64.exe
```

Die portable Variante heisst:

```text
ELFIX-Portable-<version>-x64.exe
```

## Releases und Auto-Updates

ELFIX nutzt `electron-updater` mit GitHub Releases:

```text
https://github.com/RoveHD/elfix/releases
```

Ein Release wird durch einen Tag wie `v0.2.0` oder manuell ueber den GitHub Actions Workflow gebaut. Fuer automatische Updates muessen die vom Workflow erzeugten Assets im GitHub Release liegen, besonders:

```text
ELFIX-Setup-<version>-x64.exe
ELFIX-Setup-<version>-x64.exe.blockmap
latest.yml
```

Die installierte App prueft beim Start automatisch auf Updates. Wenn ein Update gefunden wird, wird es automatisch heruntergeladen, installiert und ELFIX danach neu gestartet. In den Einstellungen gibt es zusaetzlich den Bereich `Updates & Version` mit installierter Version, Update-Quelle, Status und Fortschritt.

## Windows Defender / SmartScreen

Damit Windows keine SmartScreen-Warnung fuer neue Installer zeigt, muss der Release-Build mit einem gueltigen Code-Signing-Zertifikat signiert werden. Der Workflow ist fuer Signing-Secrets vorbereitet:

```text
CSC_LINK
CSC_KEY_PASSWORD
```

Ohne echtes Code-Signing-Zertifikat kann eine Warnung bei unbekannten Downloads nicht technisch garantiert verhindert werden.

## Android Build

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

Die Debug-APK liegt danach unter:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Entwicklung

```powershell
cd StreamingBrowserElectron
npm start
```

Tests/Syntaxchecks:

```powershell
cd StreamingBrowserElectron
npm run test
```
