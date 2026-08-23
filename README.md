# ELFIX

ELFIX ist ein kompakter Streaming-Browser fuer Desktop und Android/Android TV. Die App buendelt konfigurierbare Anbieter, globale Direktsuche, Favoriten, Anbieter-Wechsel, Adblock-/Popup-Blocking und eine moderne Startseite.

Alle Aenderungen je Version stehen in [CHANGELOG.md](CHANGELOG.md).

## Features

- Windows-App mit Chromium-Webviews und installierbarem Setup
- Android/Android-TV-App mit Touch-, D-Pad- und Mausmodus
- Anbieter-Verwaltung fuer AniWorld, S.to, Filmo und eigene Provider - samt Umzug, wenn eine Seite ihre Adresse wechselt
- Globale Suche mit Anbieter-spezifischen Such-URLs und Schreibweisen wie `spiderman`/`spider-man`
- Favoriten mit Anbieter-spezifischer Bild-Erkennung und Fortschrittslogik
- Intro ueberspringen: gelernt aus den eigenen Spruengen, angeboten als Knopf - nie von selbst
- Startseiten-Reihe "Empfohlen fuer dich": Vorschlaege aus den Genres des Verlaufs und den Aehnlichkeits-Listen der Anbieter
- Watchparty: mehrere Raeume gleichzeitig, jeder mit eigenem Fortschritt und eigener Live-Steuerung
- Meine Geraete: ein Schluessel haelt Laptop und Rechner auf demselben Stand - samt Wiedergabezeit, ohne Konto, und das Relay kann nicht mitlesen
- Mediathek fuer abgeschlossene Titel: loeschen mit Rueckfrage, Reihenfolge per Ziehen
- Hinweis, wenn zu einer abgeschlossenen Serie neue Folgen erscheinen
- Eigene Titelbilder je Eintrag, wenn das Bild des Anbieters nichts taugt
- Verlauf mit Suche, Filtern nach Zeitraum, Art und Anbieter sowie Tagesueberschriften
- Tastenkuerzel fuer Suche, Zurueck, Vollbild, naechste Folge und den Watchparty-Wechsel - auch waehrend die Anbieterseite vorn liegt
- Handy als Fernbedienung: Pause, Spulen, naechste Folge, Vollbild und Ton - eine Seite im Browser, auf Wunsch als App auf dem Startbildschirm
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

## Handy als Fernbedienung

Vom Sofa aus anhalten, ohne aufzustehen. Auf dem Telefon ist nichts zu
installieren: die Seite liefert das Relay unter `/fern` selbst aus.

Einzurichten unter *Einstellungen > Fernbedienung*:

1. **Fernbedienung erlauben** einschalten. Dabei entsteht ein Kopplungscode aus
   acht Zeichen.
2. Den **QR-Code** daneben mit der Kamera scannen - damit oeffnet sich die
   Seite und ist gleich gekoppelt. Wer lieber tippt: im Handybrowser
   `https://dein-relay.example.com/fern/` oeffnen und den Code eintragen. So
   oder so merkt das Handy ihn sich; beim naechsten Mal ist es sofort da.
3. Wenn sie liegen bleiben soll: **Als App installieren** druecken (oder im
   Browsermenue *Zum Startbildschirm hinzufuegen*). Danach liegt die
   Fernbedienung als eigenes Symbol auf dem Handy, oeffnet ohne Browserleiste
   und startet mit dem letzten Code.

Dann gibt es sechs Knoepfe: 10 Sekunden zurueck, Pause/Weiter, 30 Sekunden vor,
Ton aus, Vollbild und naechste Folge. *Vollbild* meint dabei den Player und
nicht das Fenster - dasselbe, was der Knopf im Bild tut. Daneben steht, was gerade laeuft, mit
Fortschrittsbalken.

Gesteuert wird immer, was gerade vorn liegt - eine Fernbedienung bedient das,
was zu sehen ist, und nicht eine Seite, die vorhin einmal offen war. Die
naechste Folge rechnet dieselbe Adresse aus wie der Knopf im Bild und das
Tastenkuerzel.

### Als App auf dem Startbildschirm

Dafuer liefert das Relay vier Dinge mit: ein Manifest, zwei Symbole (192 und
512) und einen Service Worker. Chrome bietet das Installieren nur an, wenn alle
da sind - und wenn die Seite ueber **https** kommt. Ueber den Cloudflare Tunnel
ist das erfuellt; ueber eine nackte IP im WLAN nicht.

Fehlt eine Bedingung, sagt die Seite das auch. Ohne diese Zeile passiert
schlicht nichts, und wer die Seite dann ueber *Zum Startbildschirm hinzufuegen*
ablegt, bekommt eine Verknuepfung mit Browserleiste statt einer App - ohne je zu
erfahren, woran es lag.

Der Service Worker haelt die Seite vor, aber nur als Rueckfall: geladen wird
immer erst aus dem Netz. Nach einem Aktualisieren des Relays steht damit sofort
die neue Fassung da statt wochenlang die alte. Ohne Verbindung oeffnet die
Fernbedienung trotzdem und sagt selbst, dass gerade nichts geht.

Symbole und Seite liegen als Zeichenketten in `.js`-Dateien (`fern-seite.js`,
`fern-icon.js`). Auch das folgt der Regel oben: kopiert werden beim
Aktualisieren nur `.js`-Dateien, und ein Startbildschirm-Symbol, das ins Leere
zeigt, faellt erst auf, wenn jemand sein Handy neu einrichtet.

### Was hinausgeht und was nicht

| Vom Rechner zum Handy | Vom Handy zum Rechner |
| --- | --- |
| Titel, Folge, Stelle, laeuft/pausiert | acht feste Befehlswoerter |

Mehr nicht. Keine Liste, kein Verlauf, keine Adresse. Wer den Code hat, kann
druecken - mitlesen kann er nicht. Und was das Relay durchlaesst, steht als
feste Liste in `fern.js`: ein Wort, das dort nicht steht, kommt gar nicht erst
an.

**Der Code ist der einzige Zugangsschutz.** Acht Zeichen aus zweiunddreissig
sind vierzig Bit, und nach drei Fehlversuchen ist fuer diese Verbindung Schluss
- durchprobieren geht also nicht. Trotzdem gilt: laeuft dein Relay ueber einen
Cloudflare Tunnel, ist `/fern` oeffentlich erreichbar. *Fernbedienung erlauben*
auszuschalten nimmt jedem Handy die Moeglichkeit, auch dem, das den Code kennt;
**Neuen Code erzeugen** loest alle gekoppelten.

Geht ELFIX aus, erfahren die Handys es und der Code koppelt niemanden mehr - die
Kopplung lebt nur, solange der Rechner da ist.

## Intro ueberspringen

Ein Intro laesst sich hier nicht *erkennen*: ELFIX sieht das Video nie, es liegt
im Rahmen des Hosters. Also andersherum - gelernt wird aus den eigenen
Spruengen.

Wer eine Serie schaut, spult das Intro selbst weg, jede Folge an derselben
Stelle. Der Player meldet Anfang und Ziel eines Sprungs auf die Sekunde genau;
das ist das Einzige, was ELFIX von einem Intro je erfahren kann. Springst du in
**zwei verschiedenen Folgen** derselben Staffel aehnlich - Beginn innerhalb von
zwoelf Sekunden, Laenge innerhalb von sechs -, entsteht daraus eine Marke, und
ab der naechsten Folge steht an dieser Stelle ein Knopf.

Gesprungen wird nur, wenn du ihn drueckst. Aus demselben Grund, aus dem die
Bildstufe nur einmal je Folge gesetzt wird: ein Skript, das ungefragt eingreift,
ist eine Bevormundung - und ein falscher Sprung kostet neunzig Sekunden
Handlung, die man erst wiederfinden muss.

Was dabei gilt:

| Regel | Warum |
| --- | --- |
| Nur Sprünge nach vorn, 20 bis 180 Sekunden | kuerzer ist ein Verspieler, laenger keine Titelmelodie |
| Nur in den ersten zehn Minuten | was spaeter uebersprungen wird, ist Handlung |
| Zwei verschiedene Folgen noetig | ein einzelner Sprung kann Langeweile gewesen sein |
| Je Folge zaehlt der letzte Sprung | wer nachjustiert, hat einmal uebersprungen, nicht dreimal |
| Je Titel **und Staffel** | Intros wechseln zwischen Staffeln |
| Waehrend einer Watchparty wird nicht gelernt | dort zieht der Host den Player, das ist nicht die eigene Entscheidung |

Aendert sich das Intro mitten in der Serie, zieht die Marke nach: gerechnet wird
der Median der groessten uebereinstimmenden Gruppe, nicht der Durchschnitt ueber
alles. Ein einzelner Ausreisser verzieht sie damit nicht.

Der eigene Knopf zaehlt nie als Beleg. Lernte die Marke von sich selbst,
verschoebe sie sich mit jedem Druck ein Stueck weiter.

Ab- und wieder anschalten unter *Einstellungen > Wiedergabe*; dort steht auch,
fuer wie viele Serien schon etwas gelernt wurde, samt **Vergessen**. Die Marken
liegen in `marken.json` im Datenordner und gelten nur fuer dieses Geraet - ueber
*Meine Geraete* wandern sie (noch) nicht mit.

Abspanne bleiben aussen vor: was am Ende einer Folge zu tun ist, weiss ELFIX
laengst - dort steht der Knopf zur naechsten Folge, mit Zaehler.

## Tastenkuerzel

| Taste | Wirkung |
| --- | --- |
| `Strg + K` | Suche oeffnen |
| `Alt + ←` | Zurueck auf der Anbieterseite |
| `F11` | Vollbild an und aus |
| `Strg + →` | Naechste Folge |
| `Strg + Umschalt + W` | *Wofuer zaehlt das hier?* - zwischen dem eigenen Stand und einer Watchparty wechseln |

Sie gelten auch, waehrend eine Anbieterseite im Vordergrund liegt. Das ist der
Grund, warum sie im Hauptprozess haengen und nicht in der Oberflaeche: die
Anbieterseite ist eine eigene `WebContentsView` **ueber** der Oberflaeche, und
ein Tastendruck dort erreicht den Renderer nie.

Zwei Regeln halten sie aus dem Weg. Jedes Kuerzel traegt eine Zusatztaste oder
ist eine Funktionstaste - ein blosses `n` waere im Suchfeld einer Anbieterseite
ein Aerger. Und wo eine Taste gerade nichts bedeutet, bekommt die Seite sie:
`Alt + ←` ohne Verlauf, `Strg + →` ausserhalb einer Folgenseite und `F11` ohne
geoeffnete Anbieterseite werden durchgereicht, statt geschluckt zu werden.

Nachzulesen sind sie in der App unter *Einstellungen > Wiedergabe*.

## Wenn ein Anbieter umzieht

AniWorld und S.to wechseln ihre Adresse - nicht oft, aber regelmaessig, und
manchmal von einer Domain auf eine blosse IP. Danach zeigt jeder Eintrag ins
Leere: Watchlist, Mediathek, abgehakte Folgen, Verlauf und die Vorschaubilder
gleich mit.

Unter *Einstellungen > Anbieter* die neue Adresse ins Feld **Website** eintragen
und **Adresse hat sich geaendert** druecken. Vor dem Umschreiben kommt eine
Rueckfrage, die sagt, was passieren wird - wie viele Eintraege mitziehen, wie
viele davon in der Mediathek stehen und wie viele Bilder betroffen sind.

Umgezogen wird ausschliesslich der Wirt. Pfad, Abfrage und Anker bleiben, wie
sie sind: liegt die Serie drueben unter demselben Pfad, passt danach alles -
liegt sie woanders, hilft der Umzug nicht, und dann waere es auch kein Umzug,
sondern ein anderer Anbieter.

Was nicht dazugehoert, bleibt stehen. Ein Vorschaubild auf einem fremden Server
zieht nicht mit, ein eigenes Bild schon gar nicht (es liegt als Data-URL vor),
und Eintraege anderer Anbieter werden nicht angefasst. Steht ein zweiter
Anbieter auf derselben alten Adresse, sagt die Rueckfrage das - er bleibt, wo er
ist.

Die Adresse ist Sache dieses Geraets. Ueber *Meine Geraete* wandert sie nicht
mit: wer denselben Anbieter anderswo unter einer anderen Adresse erreicht, soll
seine behalten.

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

**Relay aktualisieren.** Nicht jede App-Version braucht das - aber wenn sich in
`sync-server/` etwas geaendert hat, muss der Dienst nachgezogen werden, sonst
fehlen dort die neuen Faehigkeiten:

```bash
git -C /pfad/zum/repo pull
sudo cp /pfad/zum/repo/sync-server/*.js /opt/elfix-watchparty/
sudo systemctl restart elfix-watchparty
curl http://localhost:8787/health
```

Kopiert werden alle `.js`-Dateien, nicht nur `server.js`. Das Relay besteht
inzwischen aus mehreren: `metadaten.js` fuer das Metadaten-Tor,
`youtube-party.js` fuer die YouTube-Watchparty, `geraete.js` fuer den Abgleich
der eigenen Geraete und `fern.js` samt `fern-seite.js` und `fern-icon.js` fuer
die Fernbedienung.
Wird nur `server.js` uebertragen, startet der Dienst gar nicht mehr - ihm fehlt
dann ein Modul.

Seite und Symbol der Fernbedienung stehen bewusst in `.js`-Dateien und nicht als
`.html` und `.png` daneben: sonst waeren genau sie die Dateien, die beim
Kopieren jedes Mal liegenblieben.

Neue Abhaengigkeiten gab es dabei bisher nie, `npm ci` ist also nicht noetig.
Kaeme doch einmal eine dazu, faellt das im Journal auf, und dann hilft
`cd /opt/elfix-watchparty && sudo npm ci --omit=dev`.

Die Antwort von `/health` nennt unter `features`, was die laufende Fassung kann.
Steht dort `youtube`, beherrscht das Relay die YouTube-Watchparty; `youtubeRaeume`
sagt, wie viele davon gerade laufen. Steht dort `geraete`, kennt es den Abgleich
der eigenen Geraete; `geraeteRaeume` sagt, wie viele Schluessel dort liegen.
Steht dort `fern`, kennt es die Fernbedienung und liefert ihre Seite unter
`/fern` aus; `fernbedienungen` sagt, wie viele Rechner gerade steuerbar sind.

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

## Meine Geraete

Watchparty verbindet Menschen. **Meine Geraete** verbindet die Geraete *einer*
Person: was am Rechner geschaut wird, steht auf dem Laptop in *Weiterschauen* an
derselben Stelle. Es gibt nichts einzustellen und nichts beizutreten - wer
denselben Schluessel traegt, hat denselben Stand.

Einzurichten unter *Einstellungen > Meine Geraete*:

1. Auf dem ersten Geraet **Neuen Schluessel erzeugen**. Es kommt etwas heraus
   wie `T5M3BQS8-4FDBBB8N-5QQ2YME2-05T7R6SY`.
2. Auf jedem weiteren Geraet denselben Schluessel eintragen und
   **Uebernehmen** druecken. Gross- und Kleinschreibung, Striche und
   Leerzeichen sind egal; `I` und `L` gelten als Eins, `O` als Null - genau die
   Verwechslungen, die beim Abschreiben vorkommen.

Der Schluessel ist zugleich der Schalter: wer ihn eintraegt, will den Abgleich.
*Dieses Geraet trennen* nimmt ihn wieder heraus - die Eintraege bleiben stehen,
sie gleichen sich nur nicht mehr ab.

Gebraucht wird dasselbe Relay wie fuer die Watchparty; die Adresse steht dort.
Eingeschaltet sein muss die Watchparty dafuer **nicht** - die eigenen Geraete
sollen zusammenbleiben, auch wenn gerade niemand mit anderen schaut.

**Was abgeglichen wird.** Folge, Stelle, Fortschritt, abgeschlossene Titel und
Folgen, Watchlist und die Reihenfolge in der Mediathek. Geloeschtes verschwindet
ueberall.

Dazu die gemessene Wiedergabezeit: *Rueckblick* und *Wrapped* zaehlen auf jedem
Geraet alles zusammen. Wer abends am Rechner und am Wochenende auf dem Laptop
schaut, saehe sonst zweimal die halbe Bilanz. Eine Sitzung ist dabei ein
Ereignis und kein Zustand - sie kommt dazu oder sie ist schon da, ueberschrieben
wird nie. Die gerade laufende bleibt, wo sie ist, bis sie zu Ende ist.

**Was nicht.** Selbst gewaehlte Titelbilder (sie liegen als Data-URL vor und
sind um ein Vielfaches groesser als alles andere zusammen) und der Verlauf je
Eintrag - beides bleibt auf dem Geraet. Eintraege einer Watchparty bleiben
ausserdem bei ihrem Raum: dort werden sie ohnehin abgeglichen, und zwei Wege
fuer denselben Stand wuerden einander ueberholen.

Faellt etwas auseinander, gilt der neuere Stand - dieselbe Regel wie in der
Watchparty. Gerechnet wird dabei in der Zeit des Relays, nicht in der des
Geraets: zwei Rechner sind sich ueber die Uhrzeit selten einig.

### Was das Relay dabei sieht

Nichts von dem, was dort steht. Aus dem Schluessel faellt dreierlei, und nur
das Erste und die Kennungen gehen hinaus:

| Ableitung | wozu | beim Relay sichtbar |
| --- | --- | --- |
| Raumkennung | wo die Eintraege liegen | ja, 32 Hexzeichen |
| Eintragskennung | welcher Eintrag welcher ist | ja, ein HMAC je Titel |
| Chiffre | AES-256-GCM | nein, nie |

Der Schluessel selbst verlaesst das Geraet nie. Ein Eintrag ist verschlossen,
bevor er hinausgeht; die Kennung ist ein HMAC und keine Pruefsumme, aus ihr
laesst sich also kein Titel zurueckrechnen. Sichtbar bleibt, wie viele
Eintraege es gibt und wann sie sich aendern.

Das ist der Unterschied zur Watchparty, und er ist beabsichtigt: dort muss der
Raum die Titel kennen, um sie anzuzeigen. Hier liest ohnehin nur der Besitzer.

Wer den Schluessel hat, ist die Person. Er gehoert nicht in einen Chat.

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

Ein Release wird durch einen Tag wie `v1.13.0` oder manuell ueber den GitHub
Actions Workflow gebaut. Von Hand gestartet fragt der Workflow nach einem Tag:
bleibt das Feld leer, wird nur gebaut - steht ein Tag darin, wird
veroeffentlicht, und der Tag entsteht dabei an dem Commit, auf dem der Lauf
startet. Das ist der Weg, wenn sich ein Tag lokal nicht pushen laesst. Fuer automatische Updates muessen die vom Workflow erzeugten Assets im GitHub Release liegen, besonders:

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
  fernbedienung.js      Handy als Fernbedienung: Verbindung und Kopplungscode
  qr.js                 QR-Code, selbst gerechnet - fuer die Kopplung
  marken.js             Intro ueberspringen: Regeln und das Skript im Player
  geraete.js            Meine Geraete: Verbindung und Abgleichregeln
  geraete-schluessel.js Schluessel, Ableitungen, Verschluesselung
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
