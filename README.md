# ELFIX

ELFIX ist ein kompakter Streaming-Browser fuer Desktop und Android/Android TV. Die App buendelt konfigurierbare Anbieter, globale Direktsuche, Favoriten, Anbieter-Wechsel, Adblock-/Popup-Blocking und eine moderne Startseite.

Alle Aenderungen je Version stehen in [CHANGELOG.md](CHANGELOG.md).

## Features

- Windows-App mit Chromium-Webviews und installierbarem Setup
- Android/Android-TV-App mit Touch-, D-Pad- und Mausmodus
- Anbieter-Verwaltung fuer AniWorld, S.to, Filmo und eigene Provider
- Globale Suche mit Anbieter-spezifischen Such-URLs und Schreibweisen wie `spiderman`/`spider-man`
- Favoriten mit Anbieter-spezifischer Bild-Erkennung und Fortschrittslogik
- Startseiten-Reihe "Empfohlen fuer dich": Vorschlaege aus den Genres des Verlaufs und den Aehnlichkeits-Listen der Anbieter
- Watchparty: mehrere Raeume gleichzeitig, jeder mit eigenem Fortschritt und eigener Live-Steuerung
- Mediathek fuer abgeschlossene Titel: loeschen mit Rueckfrage, Reihenfolge per Ziehen
- Hinweis, wenn zu einer abgeschlossenen Serie neue Folgen erscheinen
- Eigene Titelbilder je Eintrag, wenn das Bild des Anbieters nichts taugt
- Verlauf mit Suche, Filtern nach Zeitraum, Art und Anbieter sowie Tagesueberschriften
- Automatische Updates ueber GitHub Releases - still im Hintergrund, ohne Installer-Fenster
- Settings mit Version, Update-Status und Fortschrittsbalken

## Wie der Fortschritt gezaehlt wird

Damit nichts durch kurzes Hineinspringen verloren geht, gelten feste Regeln:

| Wert | Bedeutung |
| --- | --- |
| 90 % | ab hier gilt eine Folge als durchgeschaut |
| 2:30 min | noetig fuer einen neuen Eintrag, fuer Spruenge nach vorn und zusaetzlich zu den 90 % |
| 60 s | noetig, um auf eine **aeltere** Folge zurueckzugehen |
| sofort | Film, Staffel 1 Folge 1, oder wenn die Watchparty genau diese Folge fuehrt |

Ist eine Folge durch, rueckt der Eintrag auf die naechste und bleibt als
"Naechste Folge" in *Weiterschauen*. Zusammengefasste Folgen ("[In E18
enthalten]") werden dabei uebersprungen, am Staffelende geht es in die naechste
Staffel, und am Serienende landet der Titel in der Mediathek.

## Watchparty

Mehrere Geraete koennen ihren Weiterschauen-Fortschritt teilen: wer weiterschaut,
aktualisiert die Liste bei allen anderen im selben Raum. Uebertragen wird nur der
Fortschritt (Titel, Adresse, Folge, Position) - die Wiedergabe laeuft auf jedem
Geraet fuer sich.

Nichts wird von selbst geteilt. Jemand stellt eine Serie ueber den `⇄` Knopf in
den Raum, die anderen sehen sie als Vorschlag, und erst wer beitritt, teilt
seinen Fortschritt.

**Mehrere Raeume gleichzeitig.** In den Einstellungen lassen sich bis zu acht
Raumcodes eintragen - etwa einer fuer die Familie und einer fuer Freunde. Jeder
Raum fuehrt seinen eigenen Weiterschauen-Eintrag: derselbe Anime in zwei Raeumen
steht zweimal in der Liste, jeweils mit dem Stand dieser Runde. Ein Eintrag ohne
Raum ist der eigene und bleibt privat.

Die Anzeige oben in der Kopfzeile sagt jederzeit, wofuer das Geschaute zaehlt -
"Privat" oder der Raum samt Live-Zustand - und ist zugleich der Schalter dazwischen.

**Live zuschauen.** Wer live beitritt, steuert mit: Pause, Weiter, Springen und
Folgenwechsel gelten fuer alle Beigetretenen derselben Runde. Es gibt immer einen
Host - wer zuerst dabei war -, an dem sich `⟲ Sync` orientiert. Faellt er weg,
uebernimmt der naechste. Live laesst sich je Raum trennen, ohne die Watchparty zu
verlassen.

Raumcodes duerfen Buchstaben aller Sprachen, Ziffern, Bindestrich und
Unterstrich enthalten und muessen mindestens vier Zeichen lang sein.

Dafuer braucht es das Relay aus `sync-server/`. Es kennt keine Konten und haelt
nur, was die Raeume ausmacht: eingestellte Titel, Mitglieder und den letzten
Stand je Titel. Das liegt in `raeume.json` neben dem Server (oder im
`STATE_DIRECTORY` des Dienstes), damit eine Watchparty einen Neustart
uebersteht:

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

**Relay aktualisieren.** Nicht jede App-Version braucht das - aber wenn sich
`sync-server/server.js` geaendert hat, muss der Dienst nachgezogen werden, sonst
fehlen dort die neuen Faehigkeiten:

```bash
git -C /pfad/zum/repo pull
sudo cp /pfad/zum/repo/sync-server/server.js /opt/elfix-watchparty/
sudo systemctl restart elfix-watchparty
curl http://localhost:8787/health
```

Die Antwort von `/health` nennt unter `features`, was die laufende Fassung kann.

Achtung: Der Raumcode ist der einzige Zugangsschutz. Cloudflare Access davor zu
setzen funktioniert nicht ohne Weiteres, weil die App keinen Browser-Login
durchlaufen kann - also einen langen, nicht zu erratenden Code waehlen.

Danach in der App unter *Einstellungen > Watchparty* eintragen:

- **Server-Adresse**: `wss://dein-relay.example.com` (`https://` wird automatisch
  zu `wss://`)
- **Raumcodes**: Code eintippen, *Raum hinzufuegen* - derselbe Code auf allen
  Geraeten. Wer den Code kennt, ist im Raum, also nicht zu einfach waehlen.
  Mehrere Codes sind moeglich; jeder erscheint als Marke mit Verbindungspunkt
- **Name dieses Geraets**: nur zur Anzeige. Wird er geaendert, zieht das Relay
  den Namen ueberall nach - es bleibt dasselbe Geraet

Ein Geraet, das spaeter dazukommt, bekommt den bekannten Stand des Raums
nachgereicht. Ein aelterer Stand ueberschreibt nie einen neueren.

Verlaesst man eine Runde, wird man herausgeworfen oder nimmt jemand den Titel
heraus, verschwindet auch dessen Weiterschauen-Eintrag. Bei fehlender Verbindung
oder ausgeschalteter Watchparty wird nichts geloescht - ein Aussetzer darf keine
Staende kosten.

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

Ein Release wird durch einen Tag wie `v1.13.0` oder manuell ueber den GitHub Actions Workflow gebaut. Fuer automatische Updates muessen die vom Workflow erzeugten Assets im GitHub Release liegen, besonders:

```text
ELFIX-Setup-<version>-x64.exe
ELFIX-Setup-<version>-x64.exe.blockmap
latest.yml
```

Die installierte App prueft beim Start automatisch auf Updates. Wird eines gefunden, laedt sie es, installiert es **still im Hintergrund** und startet danach neu - der Installer zeigt keine Seiten mehr und fragt nicht nach dem Installationsort. Installiert wird immer nur fuer den angemeldeten Benutzer nach `%LOCALAPPDATA%\Programs\ELFIX`. In den Einstellungen gibt es zusaetzlich den Bereich `Updates & Version` mit installierter Version, Update-Quelle, Status und Fortschritt.

Der Ablauf fuer ein Release:

```powershell
cd StreamingBrowserElectron
npm test
npm run lint
# Version in package.json und package-lock.json setzen (nur ueber JSON, nie per Textersetzung)
npm ci --dry-run
git commit -am "Release ELFIX <version>"
git tag -a v<version> -m "Release ELFIX <version>"
git push origin main --follow-tags
```

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
npm run lint
```

### Aufbau

```text
StreamingBrowserElectron/src/
  main.js               Hauptprozess: Anbieter-Views, Fortschritt, Updates, IPC
  preload.js            Bruecke zwischen Oberflaeche und Hauptprozess
  discover.js           Auslesen der Anbieterseiten (Kacheln, Genres, Staffeln)
  taste.js              Geschmacksprofil fuer "Empfohlen fuer dich"
  watchparty.js         Ein Raum: Verbindung, Mitglieder, Live-Steuerung
  watchparty-raeume.js  Mehrere Raeume nebeneinander
  renderer/             Oberflaeche (index.html, renderer.js, styles.css)
sync-server/            Relay fuer die Watchparty
shared/                 Von Desktop und Android gemeinsam genutztes Anbietermodell
android/                Android- und Android-TV-App
```

Der Hauptprozess redet nie direkt mit der Oberflaeche: alles laeuft ueber
`ipcMain.handle` und die in `preload.js` freigegebenen Aufrufe. Die Anbieter-
Seiten liegen als eigene `WebContentsView` **ueber** der Oberflaeche - was dort
sichtbar sein soll, muss entweder in die Kopfzeile oder in ein Fenstermenue,
nicht in ein HTML-Element darueber.
