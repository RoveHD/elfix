# Watchparty

Mehrere Geräte teilen ihren Weiterschauen-Fortschritt: wer weiterschaut,
aktualisiert die Liste bei allen anderen im selben Raum. Übertragen wird nur der
Fortschritt (Titel, Adresse, Folge, Position) — die Wiedergabe läuft auf jedem
Gerät für sich, bis jemand *live* beitritt.

Nichts wird von selbst geteilt. Jemand stellt eine Serie über den `⇄` Knopf in
den Raum, die anderen sehen sie als Vorschlag, und erst wer beitritt, teilt
seinen Fortschritt.

## Mehrere Räume gleichzeitig

In den Einstellungen lassen sich bis zu acht Raumcodes eintragen — etwa einer
für die Familie und einer für Freunde. Jeder Raum führt seinen eigenen
Weiterschauen-Eintrag: derselbe Anime in zwei Räumen steht zweimal in der Liste,
jeweils mit dem Stand dieser Runde. Ein Eintrag ohne Raum ist der eigene und
bleibt privat.

Die Anzeige oben in der Kopfzeile sagt jederzeit, wofür das Geschaute zählt —
„Privat" oder der Raum samt Live-Zustand — und ist zugleich der Schalter
dazwischen (`Strg + Umschalt + W`).

## Live zuschauen

Wer live beitritt, steuert mit: Pause, Weiter, Springen und Folgenwechsel gelten
für alle Beigetretenen derselben Runde. Es gibt immer einen Host — wer zuerst
dabei war —, an dem sich `⟲ Sync` orientiert. Fällt er weg, übernimmt der
nächste. Live lässt sich je Raum trennen, ohne die Watchparty zu verlassen.

**Der Folgenwechsel wartet auf die Runde.** Auch Gäste dürfen die nächste Folge
wählen. Die verbundenen Teilnehmer laden pausiert und starten erst nach ihren
Bereitschaftsmeldungen; ein Abbruch, eine verspätete Quelle oder ein
Wiederanschluss lösen keinen veralteten Start mehr aus. Erwartet wird dabei nur,
wer den Titel wirklich im Player hat — wer die neue Folge nicht aufbekommt, sagt
ab, statt die Runde festzuhalten. Wer eine Vorbereitung verpasst hat, wird vom
gemeinsamen Start nachgeholt.

**Das Intro darf jeder überspringen**, nicht nur der Host — über dieselbe
gemeinsame Startverabredung. Freies Spulen bleibt beim Host.

**Miniplayer und Bild-in-Bild werfen niemanden heraus.** PiP, Vollbild und der
normale Player sind nur Darstellungen desselben Laufs: Raum, Geräte-ID,
Player-Sitzung, Herzschlag und Hostrolle bleiben erhalten.

## Warteschlange, Abstimmung und Glücksrad

Jeder Raum führt eine gemeinsame Warteschlange: jeder schlägt Titel vor, die
Runde stimmt ab, und der gewählte Titel läuft danach für alle.

- Jeder hat **drei gewichtete Stimmen** (3, 2 und 1), jedes Gewicht genau
  einmal. Sortiert wird nach der Summe. Ein Vorschlag vergibt keine Stimme von
  selbst, und starten lässt sich jeder Eintrag.
- Der Start läuft **zweiphasig**: erst laden alle die neue Quelle, und erst wenn
  jedes Gerät sie bestätigt, wechselt die Runde. Meldet eines einen Fehler,
  kommt der Vorschlag zurück in die Liste und der bisherige Titel bleibt stehen.
- Optional entscheidet ein **Glücksrad**: die Punkte bestimmen die
  Segmentgrößen, jeder Vorschlag behält ein Stück. Das Los fällt im Relay, und
  alle sehen dieselbe Scheibe zur selben Zeit — auch wer mitten im Lauf
  dazukommt.

YouTube-Runden führen ihre eigene Videoliste mit eigenem Zustand.

## Chat

Ein links ausklappbarer Chat steht im eigenen Player auf PC, Handy und TV
bereit. Nachrichten und Entwürfe bleiben dem jeweiligen Raum zugeordnet; Lesen
und Schreiben stören die Tastatursteuerung des Players nicht.

## Raumcodes

Raumcodes dürfen Buchstaben aller Sprachen, Ziffern, Bindestrich und
Unterstrich enthalten und müssen mindestens vier Zeichen lang sein.

**Der Raumcode ist der einzige Zugangsschutz.** Cloudflare Access davorzusetzen
funktioniert nicht ohne Weiteres, weil die App keinen Browser-Login durchlaufen
kann — also einen langen, nicht zu erratenden Code wählen.

## In der App eintragen

Unter *Einstellungen > Watchparty*:

- **Server-Adresse**: `wss://dein-relay.example.com` (`https://` wird
  automatisch zu `wss://`)
- **Raumcodes**: Code eintippen, *Raum hinzufügen* — derselbe Code auf allen
  Geräten. Wer den Code kennt, ist im Raum. Mehrere Codes sind möglich; jeder
  erscheint als Marke mit Verbindungspunkt
- **Name dieses Geräts**: nur zur Anzeige. Wird er geändert, zieht das Relay den
  Namen überall nach — es bleibt dasselbe Gerät

Ein Gerät, das später dazukommt, bekommt den bekannten Stand des Raums
nachgereicht. Ein älterer Stand überschreibt nie einen neueren.

Verlässt man eine Runde, wird man herausgeworfen oder nimmt jemand den Titel
heraus, verschwindet auch dessen Weiterschauen-Eintrag. Bei fehlender Verbindung
oder ausgeschalteter Watchparty wird nichts gelöscht — ein Aussetzer darf keine
Stände kosten.

---

# Das Relay betreiben

Watchparty, *Meine Geräte*, die Fernbedienung und das Metadaten-Tor laufen alle
über dasselbe kleine Programm aus `sync-server/`. Es kennt keine Konten und
hält nur, was die Räume ausmacht: eingestellte Titel, Mitglieder und den letzten
Stand je Titel. Das liegt in `raeume.json` neben dem Server (oder im
`STATE_DIRECTORY` des Dienstes), damit eine Watchparty einen Neustart übersteht.

**Der einfachste Weg** ist das fertige Paket — es bringt seine eigene Laufzeit
mit, Node muss dafür nicht installiert sein. Wie das geht, steht in
[`sync-server/README.md`](../sync-server/README.md). Was folgt, ist der Weg aus
dem Quellcode.

## Aus dem Quellcode starten

```bash
cd sync-server
npm ci
npm start
```

Der Server hört auf `PORT` (Standard 8787) und läuft unverändert auf den
üblichen Free-Tier-Hostern.

## Dauerbetrieb unter Linux mit Cloudflare Tunnel

Node muss mindestens Version 18 sein — Mint 21 liefert noch 12.22 mit, das
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
zeigt — entweder im Dashboard (*Service: HTTP*, *URL: localhost:8787*) oder in
der `config.yml`:

```yaml
ingress:
  - hostname: watchparty.deine-domain.tld
    service: http://localhost:8787
  - service: http_status:404
```

WebSockets müssen in Cloudflare aktiv sein (*Network > WebSockets*, im Normalfall
schon an). Cloudflare kappt stille Verbindungen nach etwa 100 Sekunden; der
Server sendet alle 30 Sekunden einen Ping und hält sie damit offen. In der App
wird dann `wss://watchparty.deine-domain.tld` eingetragen.

## Relay aktualisieren

Nicht jede App-Version braucht das — aber wenn sich in `sync-server/` etwas
geändert hat, muss der Dienst nachgezogen werden, sonst fehlen dort die neuen
Fähigkeiten:

```bash
git -C /pfad/zum/repo pull
sudo cp /pfad/zum/repo/sync-server/*.js /opt/elfix-watchparty/
sudo systemctl restart elfix-watchparty
curl http://localhost:8787/health
```

Kopiert werden **alle** `.js`-Dateien, nicht nur `server.js`. Das Relay besteht
inzwischen aus mehreren: `metadaten.js` für das Metadaten-Tor, `youtube-party.js`
für die YouTube-Watchparty, `warteschlange.js` für Warteschlange und Glücksrad,
`geraete.js` für den Abgleich der eigenen Geräte, `fern.js` samt `fern-seite.js`
und `fern-icon.js` für die Fernbedienung, `status-seite.js` für die Statusseite
und `statusleiste.js` samt `seite-zeigen.js` für den Punkt in der Leiste. Wird
nur `server.js` übertragen, startet der Dienst gar nicht mehr — ihm fehlt dann
ein Modul.

Seite und Symbol der Fernbedienung und die Statusseite stehen bewusst in
`.js`-Dateien und nicht als `.html` und `.png` daneben: sonst wären genau sie
die Dateien, die beim Kopieren jedes Mal liegenblieben.

Neue Abhängigkeiten gab es dabei bisher nie, `npm ci` ist also nicht nötig.
Käme doch einmal eine dazu, fällt das im Journal auf, und dann hilft
`cd /opt/elfix-watchparty && sudo npm ci --omit=dev`.

## Läuft es noch?

Wer das Relay als fertige Datei installiert hat, sieht es unten in der
Statusleiste: ein grüner Punkt, solange es läuft, ein roter, wenn es nicht mehr
antwortet — unter Windows aus der Datei selbst heraus, unter Linux aus dem
`.deb`, das ihn beim Anmelden startet. Klick oder Doppelklick darauf öffnet die
Statusseite; im Anwendungsmenü steht sie unter *ELFIX Relay*. Beim allerersten
Start unter Windows geht sie einmal von selbst auf. Wer das nicht will:
`ELFIX_RELAY_LEISTE=0` und `ELFIX_RELAY_SEITE=0`.

Sonst: die Adresse des Relays im Browser aufrufen — unter `/` (und unter
`/status`) steht eine Seite, die genau das beantwortet: Zustand, Fassung,
Laufzeit, Räume, Verbindungen, TMDB-Schlüssel und die Adresse für die App. Sie
fragt alle drei Sekunden nach und meldet es, wenn keine Antwort mehr kommt.
Raumcodes, Titel und Namen stehen dort nicht — die Seite ist so öffentlich wie
das Relay. `curl` auf `/` bekommt weiterhin seine eine Zeile Text, und `/health`
bleibt die Auskunft für Programme.

Die Antwort von `/health` nennt unter `features`, was die laufende Fassung kann:

| Eintrag | Bedeutung | Zähler daneben |
| --- | --- | --- |
| `youtube` | YouTube-Watchparty | `youtubeRaeume` |
| `geraete` | Abgleich der eigenen Geräte | `geraeteRaeume` |
| `fern` | Fernbedienung samt Seite unter `/fern` | `fernbedienungen` |
| `fernapp` | Die Seite bringt Manifest, Symbole und Service Worker mit und lässt sich am Handy als App installieren | — |
| `status` | Statusseite; `/health` nennt dann auch `fassung`, `laeuftSeitS` und `verbindungen` | — |

Fehlt `fernapp`, gibt Chrome nur eine Verknüpfung her statt einer App. ELFIX
fragt genau danach und sagt es in den Einstellungen.
