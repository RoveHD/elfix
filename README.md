# ELFIX

**Ein Streaming-Browser für Desktop und Android/Android TV.** ELFIX bündelt
deine Anbieter in einer App: eine Suche über alle, ein eigener Player statt des
Hoster-Players, ein Fortschritt, der über alle Geräte hinweg stimmt — und ein
gemeinsames Schauen, das sich nicht wie ein Bastelprojekt anfühlt.

> Aktuelle Fassung: **2.0.22** · Alle Änderungen je Version stehen im
> [CHANGELOG](CHANGELOG.md).

## Inhalt

- [Was ELFIX ist](#was-elfix-ist)
- [Installieren](#installieren)
- [Funktionen](#funktionen)
  - [Schauen](#schauen)
  - [Finden](#finden)
  - [Behalten](#behalten)
  - [Gemeinsam](#gemeinsam)
  - [Ruhe auf der Seite](#ruhe-auf-der-seite)
- [Wie der Fortschritt gezählt wird](#wie-der-fortschritt-gezählt-wird)
- [Tastenkürzel](#tastenkürzel)
- [Anbieter verwalten](#anbieter-verwalten)
- [Das Relay](#das-relay)
- [Entwicklung](#entwicklung)
- [Weitere Dokumentation](#weitere-dokumentation)

## Was ELFIX ist

| | Desktop | Android / Android TV |
| --- | --- | --- |
| Grundlage | Electron mit Chromium-`WebContentsView` | native App, `minSdk 26` |
| Bedienung | Maus, Tastenkürzel, Fenster | Touch, D-Pad, Mausmodus |
| Auslieferung | Installer und portable `.exe` | signierte APK |
| Updates | still im Hintergrund über GitHub Releases | Hintergrund-Download, eine Rückfrage |

Beide teilen sich das Anbietermodell, die Empfehlungsrechnung, den
Anbieterkalender und die Regeln für Fortschritt und Spoilerschutz — was auf dem
einen Gerät gilt, gilt auf dem anderen genauso.

## Installieren

**Windows.** Die aktuelle Fassung liegt unter
[Releases](https://github.com/RoveHD/elfix/releases):

- `ELFIX-Setup-<version>-x64.exe` installiert nach
  `%LOCALAPPDATA%\Programs\ELFIX` und hält sich danach selbst aktuell.
- `ELFIX-Portable-<version>-x64.exe` startet ohne Installation.

Beide sind nicht code-signiert — SmartScreen meldet sich beim ersten Start.

**Android / Android TV.** Die APK aus demselben Release installieren
(*Unbekannte Apps installieren* muss einmalig erlaubt sein). Danach aktualisiert
sich die App selbst und fragt vor jeder Installation.

**Optional: das Relay.** Watchparty, *Meine Geräte*, die Fernbedienung und das
Metadaten-Tor brauchen einen kleinen eigenen Server. Ohne ihn läuft alles
andere. Siehe [Das Relay](#das-relay).

## Funktionen

### Schauen

- **Eigener Player statt Hoster-Rahmen.** ELFIX holt die Quelle hinter dem
  Hoster und spielt sie selbst ab — kein fremder Player, keine Werbeschicht, die
  weggeräumt werden muss, und Qualität, Untertitel und Position bleiben unter
  eigener Kontrolle.
- **Skip-Marken in der Zeitleiste.** Öffentliche Daten für Intro, Rückblick,
  Abspann und Vorschau werden zusammengeführt und farbig markiert; „Nächste
  Folge" erscheint ab erkanntem Abspann, ersatzweise ab 90 Prozent der Laufzeit.
- **Intro überspringen, selbst gelernt.** Aus deinen eigenen Sprüngen entsteht
  eine Marke, angeboten als Knopf — nie von selbst ausgeführt.
- **Fassung merken (Sub/Dub).** Ab der zweiten Folge steht die Flagge
  vorgewählt, mit der du angefangen hast. Auch die Untertitelspur bleibt
  gemerkt.
- **Mini-Player und Bild-in-Bild.** Auf Windows läuft das Video beim Stöbern in
  Startseite, Suche und Mediathek weiter; Android-Handys wechseln beim Verlassen
  der App automatisch in PiP.
- **Vorschau beim Spulen.** Die Zeitleiste zeigt eine echte Videominiatur samt
  Position und Abschnitt; die Wiedergabe bleibt bis zum Loslassen stehen.
- **Handy-Gesten.** Doppel-Tap für zehn Sekunden vor und zurück, horizontales
  Wischen mit Vorschau und Abbruchmöglichkeit.
- **Handy als Fernbedienung.** Pause, Spulen, Folge vor und zurück, Vollbild und
  Ton — und die angefangenen Serien zum Aussuchen, wenn gerade nichts läuft.

### Finden

- **Globale Suche über alle Anbieter**, mit anbieterspezifischen Such-URLs und
  Schreibweisen wie `spiderman`/`spider-man`. Passende Treffer verschiedener
  Anbieter erscheinen gemeinsam, mit Anbieterwahl. YouTube bleibt getrennt.
- **„Empfohlen für dich"** auf der Startseite: Vorschläge aus den Genres deines
  Verlaufs und den Ähnlichkeitslisten der Anbieter, mit Vielfalt und Erkundung
  in der Bewertung.
- **Anbieterkalender** auf beiden Plattformen — was diese Woche erscheint.
- **Metadaten ohne Schlüssel auf dem Gerät.** TMDB und AniList werden über das
  Relay gefragt; der Schlüssel liegt dort und nicht in der App.

### Behalten

- **Weiterschauen** mit Folge, Stelle und Fortschritt — nach festen Regeln, die
  unten stehen.
- **Mediathek** für abgeschlossene Titel: löschen mit Rückfrage, Reihenfolge per
  Ziehen, Hinweis bei neuen Folgen einer abgeschlossenen Serie.
- **Verlauf** mit Suche, Filtern nach Zeitraum, Art und Anbieter sowie
  Tagesüberschriften.
- **Spoilerschutz.** Folgentitel und Vorschaubilder bleiben verdeckt, bis du so
  weit bist; was die Mediathek als geschaut führt, zählt als gesehen, und was
  ELFIX nie mitbekommen hat, lässt sich in der Folgenliste abhaken — je Folge
  oder ganze Staffel, mit Rücknahme.
- **Eigene Titelbilder** je Eintrag, wenn das Bild des Anbieters nichts taugt.
- **Rückblick und Wrapped.** Gemessene Wiedergabezeit, nichts hochgerechnet: was
  nicht gemessen wurde, bleibt als unbekannt ausgewiesen.
- **Meine Geräte.** Ein Schlüssel hält Laptop und Rechner auf demselben Stand —
  ohne Konto, und das Relay kann nicht mitlesen.

### Gemeinsam

- **Watchparty.** Mehrere Räume gleichzeitig, jeder mit eigenem Fortschritt und
  eigener Live-Steuerung. Der Folgenwechsel wartet auf die Runde.
- **Gemeinsame Warteschlange.** Jeder schlägt vor, die Runde stimmt mit drei
  gewichteten Stimmen ab — oder ein Glücksrad entscheidet, für alle sichtbar
  zur selben Zeit.
- **Livechat im Player** auf PC, Handy und TV, je Raum getrennt.
- **YouTube-Watchparty** als eigenes System, mit eigener Videoliste,
  SponsorBlock-Sprüngen für die Runde und Return-YouTube-Dislike-Zahlen.

### Ruhe auf der Seite

- **Adblock auf Basis von `@adguard/tsurlfilter`** — also die Engine, die
  AdGuard selbst in seiner Browsererweiterung verwendet, samt kosmetischen
  Regeln. Genau die braucht es gegen die Fake-Gewinnspiele der Streaming-Seiten,
  die oft nur ein paar nachträglich eingehängte DIVs sind.
- **Popup- und Weiterleitungsblockade**, Verifizierungstor und harte
  IPC-Grenzen zwischen Anbieterseite und App.

## Wie der Fortschritt gezählt wird

Damit nichts durch kurzes Hineinspringen verloren geht, gelten feste Regeln:

| Wert | Bedeutung |
| --- | --- |
| 90 % | ab hier gilt eine Folge als durchgeschaut |
| 2:30 min | nötig für einen neuen Eintrag, für Sprünge nach vorn und zusätzlich zu den 90 % |
| 60 s | nötig, um auf eine **ältere** Folge zurückzugehen |
| sofort | Film, Staffel 1 Folge 1, oder wenn die Watchparty genau diese Folge führt |

Ist eine Folge durch, rückt der Eintrag auf die nächste und bleibt als „Nächste
Folge" in *Weiterschauen*. Zusammengefasste Folgen („[In E18 enthalten]") werden
dabei übersprungen, am Staffelende geht es in die nächste Staffel, und am
Serienende landet der Titel in der Mediathek.

## Tastenkürzel

| Taste | Wirkung |
| --- | --- |
| `Strg + K` | Suche öffnen |
| `Alt + ←` | Zurück auf der Anbieterseite |
| `F11` | Vollbild an und aus |
| `Strg + →` | Nächste Folge |
| `Strg + Umschalt + W` | *Wofür zählt das hier?* — zwischen eigenem Stand und Watchparty wechseln |

Sie gelten auch, während eine Anbieterseite im Vordergrund liegt. Das ist der
Grund, warum sie im Hauptprozess hängen und nicht in der Oberfläche: die
Anbieterseite ist eine eigene `WebContentsView` **über** der Oberfläche, und ein
Tastendruck dort erreicht den Renderer nie.

Zwei Regeln halten sie aus dem Weg. Jedes Kürzel trägt eine Zusatztaste oder ist
eine Funktionstaste — ein bloßes `n` wäre im Suchfeld einer Anbieterseite ein
Ärger. Und wo eine Taste gerade nichts bedeutet, bekommt die Seite sie:
`Alt + ←` ohne Verlauf, `Strg + →` außerhalb einer Folgenseite und `F11` ohne
geöffnete Anbieterseite werden durchgereicht statt geschluckt.

Nachzulesen sind sie in der App unter *Einstellungen > Wiedergabe*.

## Anbieter verwalten

Unter *Einstellungen > Anbieter* stehen AniWorld, S.to, Filmo und beliebige
eigene Anbieter. Jeder bringt seine Website, seine Such-URL und seine Regeln zum
Auslesen von Kacheln, Genres und Staffeln mit; das Modell dazu steht in
[`shared/provider-schema.json`](shared/provider-schema.json).

### Wenn ein Anbieter umzieht

AniWorld und S.to wechseln ihre Adresse — nicht oft, aber regelmäßig, und
manchmal von einer Domain auf eine bloße IP. Danach zeigt jeder Eintrag ins
Leere: Watchlist, Mediathek, abgehakte Folgen, Verlauf und die Vorschaubilder
gleich mit.

Die neue Adresse ins Feld **Website** eintragen und **Adresse hat sich geändert**
drücken. Vor dem Umschreiben kommt eine Rückfrage, die sagt, was passieren wird
— wie viele Einträge mitziehen, wie viele davon in der Mediathek stehen und wie
viele Bilder betroffen sind.

Umgezogen wird ausschließlich der Wirt. Pfad, Abfrage und Anker bleiben, wie sie
sind: liegt die Serie drüben unter demselben Pfad, passt danach alles — liegt sie
woanders, hilft der Umzug nicht, und dann wäre es auch kein Umzug, sondern ein
anderer Anbieter.

Was nicht dazugehört, bleibt stehen. Ein Vorschaubild auf einem fremden Server
zieht nicht mit, ein eigenes Bild schon gar nicht (es liegt als Data-URL vor),
und Einträge anderer Anbieter werden nicht angefasst. Steht ein zweiter Anbieter
auf derselben alten Adresse, sagt die Rückfrage das — er bleibt, wo er ist.

Die Adresse ist Sache dieses Geräts. Über *Meine Geräte* wandert sie nicht mit:
wer denselben Anbieter anderswo unter einer anderen Adresse erreicht, soll seine
behalten.

## Das Relay

Ein kleines Programm aus [`sync-server/`](sync-server/), das vier Dinge
zusammen erledigt: Watchparty-Räume, den Abgleich der eigenen Geräte, die
Fernbedienungsseite unter `/fern` und das Metadaten-Tor zu TMDB und AniList. Es
kennt keine Konten und speichert nur, welche Titel in welchen Räumen stehen und
wo jeder gerade ist.

Am schnellsten geht es mit dem fertigen Paket — es bringt seine eigene Laufzeit
mit, Node muss dafür nicht installiert sein:

```bash
sudo apt install ./ELFIX-Relay-<fassung>-amd64.deb
```

Aus dem Quellcode:

```bash
cd sync-server
npm ci
npm start          # hört auf PORT, Standard 8787
```

Ob es läuft, sagt die Statusseite unter `/` beziehungsweise `/status`; `/health`
ist dieselbe Auskunft als JSON. Installation als Dienst, Cloudflare Tunnel,
Aktualisieren und die `features`-Tabelle stehen in
[docs/WATCHPARTY.md](docs/WATCHPARTY.md) und
[sync-server/README.md](sync-server/README.md).

> **Achtung:** Raumcode und Kopplungscode sind der einzige Zugangsschutz. Wer
> das Relay öffentlich erreichbar macht, sollte lange, nicht zu erratende Codes
> wählen.

## Entwicklung

Gebraucht werden **Node 22** (Node 18 ist das Minimum fürs Relay) und für die
Android-App ein JDK samt Android SDK 35.

```powershell
cd StreamingBrowserElectron
npm ci
npm start
```

### Prüfungen

```powershell
npm run lint           # eigener Linter
npm test               # Syntaxprüfung aller Module + Node-Suite (tests/run.js)
npm run test:electron  # 17 Electron-Suiten gegen einen echten Player
```

Für Android:

```powershell
cd android
.\gradlew.bat :app:testDebugUnitTest
```

Der Release-Workflow lässt `npm audit`, `npm test` und `npm run test:electron`
laufen, bevor überhaupt gebaut wird.

### Aufbau

```text
StreamingBrowserElectron/   Desktop-App (Electron)
  src/                      Haupt- und Renderer-Prozess
  shared/                   Anbietermodell, Bildausschnitt, Verlauf, Suchgruppen
  tests/                    Node- und Electron-Suiten
  scripts/                  Bundling (Adblock, Preload), Icon, Linter
android/                    Android- und Android-TV-App (Kotlin/Java, Gradle)
sync-server/                Relay: Watchparty, Geräte, Fernbedienung, Metadaten
shared/                     provider-schema.json — das Anbietermodell als Schema
docs/                       Tiefen-Dokumentation
GlobalSearchHub/, search-hub/   ältere, eigenständige Such-Werkzeuge
```

Die wichtigsten Module im Hauptprozess:

```text
main.js                 Anbieter-Views, Fortschritt, Updates, IPC
preload.js              Brücke zwischen Oberfläche und Hauptprozess
ipc-schutz.js           Wer darf über IPC was — Absender und Frame werden geprüft
discover.js             Auslesen der Anbieterseiten (Kacheln, Genres, Staffeln)
direktquelle.js         Die Quelle hinter dem Hoster — Grundlage des eigenen Players
skipsegmente.js         Intro, Rückblick, Abspann, Vorschau aus öffentlichen Daten
marken.js               Intro überspringen: gelernte Marken und das Skript im Player
fassung.js              Sub/Dub merken · untertitelwahl.js  gemerkte Untertitelspur
taste.js                Geschmacksprofil für „Empfohlen für dich"
empfehlung.js           Die Bewertung: Profil, Punkte, Vielfalt, Erkundung
empfehlungslauf.js      Der Lauf drumherum — läuft auch im Android-Kern
kalender.js             Anbieterkalender, ebenfalls für beide Plattformen
metadaten.js            TMDB/AniList über das Relay, mit Cache und Aufgeben
statistik.js            Datenbasis für Rückblick und Wrapped
spoilerschutz.js        Was als „gesehen" gilt — reine Regel, ohne Ablage
watchparty*.js          Räume, Live-Steuerung, Warteschlange, Autostart
youtube*.js             YouTube-Watchparty, SponsorBlock, Dislikes, Queue
geraete.js              Meine Geräte · geraete-schluessel.js  Ableitung und AES-GCM
fernbedienung.js        Kopplung und Verbindung · qr.js  QR-Code, selbst gerechnet
adblock-engine.js       tsurlfilter-Kern · adblock-kosmetik.js  kosmetische Regeln
renderer/               Oberfläche (index.html, renderer.js, styles.css, spieler.js)
```

Zwei Architekturregeln, die alles andere erklären:

1. **Der Hauptprozess redet nie direkt mit der Oberfläche.** Alles läuft über
   `ipcMain.handle` und die in `preload.js` freigegebenen Aufrufe.
2. **Die Anbieterseiten liegen als eigene `WebContentsView` über der
   Oberfläche.** Was dort sichtbar sein soll, muss in die Kopfzeile oder in ein
   Fenstermenü — nicht in ein HTML-Element darüber.

Rechnende Module (Empfehlung, Kalender, Statistik, Spoilerschutz, Fortschritt)
kennen weder Electron noch das Dateisystem. Deshalb laufen sie im Android-Kern
mit und lassen sich vollständig prüfen.

## Weitere Dokumentation

| Datei | Inhalt |
| --- | --- |
| [CHANGELOG.md](CHANGELOG.md) | Alle Versionen, neueste zuerst |
| [docs/WATCHPARTY.md](docs/WATCHPARTY.md) | Watchparty, Warteschlange, Glücksrad und der Betrieb des Relays |
| [docs/MEINE-GERAETE.md](docs/MEINE-GERAETE.md) | Geräteabgleich, was abgeglichen wird und was das Relay sieht |
| [docs/FERNBEDIENUNG.md](docs/FERNBEDIENUNG.md) | Handy als Fernbedienung, Kopplung und Installation als App |
| [docs/INTRO-UND-FASSUNG.md](docs/INTRO-UND-FASSUNG.md) | Gelernte Intro-Marken, Sub/Dub und Untertitelspur |
| [docs/SKIP-SEGMENTE.md](docs/SKIP-SEGMENTE.md) | Öffentliche Skip-Daten im eigenen Player |
| [docs/PLAYER-KOMFORT.md](docs/PLAYER-KOMFORT.md) | Mini-Player, Gesten, Bildvorschau, zusammengefasste Suche |
| [docs/PERFORMANCE-PRUEFUNG.md](docs/PERFORMANCE-PRUEFUNG.md) | Messungen und Befunde nach 2.0.19 |
| [docs/BUILDS-UND-RELEASES.md](docs/BUILDS-UND-RELEASES.md) | Bauen, Testbau eines Zweigs, Signierung, Auto-Updates |
| [sync-server/README.md](sync-server/README.md) | Das Relay installieren und betreiben |
