# ELFIX Watchparty-Relay

Das kleine Programm, über das ELFIX-Geräte ihren Weiterschauen-Fortschritt
teilen. Es ist außerdem das Metadaten-Tor: die App fragt es statt TMDB, damit
der TMDB-Schlüssel nicht auf die Geräte muss.

Es speichert nur, welche Titel in welchen Räumen stehen und wo jeder gerade
ist. Kein Chatverlauf, keine Konten, keine Zugangsdaten.

## Installieren

Seit 1.62.0 gibt es das Relay als fertige Datei. Sie bringt ihre eigene
Laufzeit mit — **Node muss nicht installiert sein.**

### Linux Mint, Ubuntu, Debian

```bash
sudo apt install ./ELFIX-Relay-<fassung>-amd64.deb
```

Das war alles. Das Paket legt einen eigenen Benutzer an, richtet den Dienst
ein und startet ihn — er läuft ab sofort auf Port 8787 und kommt nach jedem
Neustart von selbst wieder.

Nachsehen, ob er läuft — im Browser:

```
http://localhost:8787/
```

Dort steht eine Seite: läuft es, seit wann, welche Fassung, wie viele Räume und
Geräte gerade dranhängen, ob der TMDB-Schlüssel eingetragen ist, und die
Adresse, die in die App gehört. Sie hält sich selbst frisch — bleibt das Relay
stehen, sagt sie das, statt weiter alte Zahlen zu zeigen. Vom Handy aus geht
dieselbe Seite über die Adresse des Relays im Netz.

Wer lieber auf der Maschine selbst nachsieht:

```bash
systemctl status elfix-relay
curl http://localhost:8787/health     # dieselben Zahlen als JSON
```

Die Seite gibt es unter `/` und unter `/status`. Auf `/` bekommt sie nur, wer
sie auch anzeigen kann: `curl` und jede Überwachung bekommen dort weiterhin die
eine Zeile Text von früher.

Was auf der Seite steht, sind Zahlen und sonst nichts — keine Raumcodes, keine
Titel, keine Namen, kein Pfad zur Ablage. Sie ist so öffentlich wie das Relay:
wer die Adresse kennt, sieht sie.

Der TMDB-Schlüssel ist freiwillig. Ohne ihn läuft alles außer Film- und
Seriendaten:

```bash
sudo install -m 600 -o root -g root /dev/null /etc/elfix-relay.env
sudo nano /etc/elfix-relay.env      # TMDB_API_TOKEN=...
sudo systemctl restart elfix-relay
```

### Windows

`ELFIX-Relay-<fassung>-win-x64.exe` herunterladen und starten. Sie öffnet ein
Fenster mit dem Protokoll und lauscht auf Port 8787. In der zweiten Zeile steht
die Adresse der Statusseite — `http://localhost:8787/status` im Browser
geöffnet, und man sieht, was der Dienst gerade tut.

Soll sie beim Anmelden von selbst starten, eine Verknüpfung in den
Autostart-Ordner legen (`Win+R` → `shell:startup`).

Die Räume liegen unter `%APPDATA%\ELFIX-Relay`.

### Anderer Port

```bash
PORT=9000 ./ELFIX-Relay-...        # Linux
set PORT=9000 && ELFIX-Relay-....exe   # Windows
```

## Aktualisiert sich selbst

Die fertige Datei sieht einmal am Tag bei den GitHub-Releases nach. Steht dort
eine neuere Fassung, holt sie die zu ihrer Plattform passende Datei und tauscht
sich aus.

Zwei Dinge tut sie dabei ausdrücklich **nicht**:

- **Kein Downgrade.** Eine kleinere Fassung als die laufende wird nie geholt —
  sonst genügte ein zurückgezogenes Release, um jedes Relay im Netz
  zurückzudrehen.
- **Kein Selbsttausch unter `/usr/bin`.** Wer über `apt` installiert hat, bekommt
  seine Aktualisierung von `apt`; eine Datei, die sich unter einem verwalteten
  Pfad selbst austauscht, wäre ein Paket, das seiner Verwaltung widerspricht.
  Dort steht die neue Fassung nur im Protokoll.

Unter systemd startet der Dienst nach dem Tausch von selbst neu. Wer das Relay
von Hand gestartet hat, bekommt die neue Fassung beim nächsten Start — ihm den
Prozess unter den Füßen wegzuziehen wäre eine Freiheit, die sich ein Programm
nicht nimmt.

Abschalten lässt es sich mit `ELFIX_RELAY_KEIN_UPDATE=1`.

## Aus dem Quelltext

Wer das Repository hat, braucht keine gebaute Datei:

```bash
cd sync-server
npm ci
node server.js
```

Aus dem Quelltext gestartet aktualisiert sich das Relay **nicht** selbst — wer
ein Repository hat, aktualisiert mit `git`.

Die Vorlage `elfix-watchparty.service` richtet den Dienst dafür von Hand ein;
sie ist der Weg für alle, die den Quelltext betreiben wollen.

## Selbst bauen

```bash
cd sync-server
node bauen.js --fassung 1.62.0          # die Datei für diese Plattform
node bauen.js --fassung 1.62.0 --deb    # zusätzlich das Paket (nur Linux)
```

Gebaut wird in drei Schritten mit Bordmitteln: esbuild bündelt, Node macht
daraus einen SEA-Blob, postject spritzt ihn in eine Kopie der Node-Binärdatei.
Der Rest steht in `bauen.js`.
