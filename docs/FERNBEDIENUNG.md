# Handy als Fernbedienung

Vom Sofa aus anhalten, ohne aufzustehen. Auf dem Telefon ist nichts zu
installieren: das Relay liefert die Seite unter `/fern` selbst aus.

## Einrichten

Unter *Einstellungen > Fernbedienung*:

1. **Fernbedienung erlauben** einschalten. Dabei entsteht ein Kopplungscode aus
   acht Zeichen.
2. Den **QR-Code** daneben mit der Kamera scannen — damit öffnet sich die Seite
   und ist gleich gekoppelt. Wer lieber tippt: im Handybrowser
   `https://dein-relay.example.com/fern/` öffnen und den Code eintragen. So oder
   so merkt das Handy ihn sich; beim nächsten Mal ist es sofort da.
3. Wenn sie liegen bleiben soll: **Als App installieren** drücken (oder im
   Browsermenü *Zum Startbildschirm hinzufügen*). Danach liegt die Fernbedienung
   als eigenes Symbol auf dem Handy, öffnet ohne Browserleiste und startet mit
   dem letzten Code.

## Was sie kann

Neun Knöpfe: 10 Sekunden zurück, Pause/Weiter, 30 Sekunden vor, vorherige und
nächste Folge, leiser, Ton aus, lauter und Vollbild. *Vollbild* meint dabei den
Player und nicht das Fenster — dasselbe, was der Knopf im Bild tut. Darüber
steht, was gerade läuft, mit Fortschrittsbalken.

Gesteuert wird immer, was gerade vorn liegt — eine Fernbedienung bedient das,
was zu sehen ist, und nicht eine Seite, die vorhin einmal offen war. Die nächste
Folge rechnet dieselbe Adresse aus wie der Knopf im Bild und das Tastenkürzel;
die vorherige ist die Folge davor in derselben Staffel.

### Anfangen, nicht nur bedienen

Darunter steht **Weiterschauen**: die angefangenen Serien dieses Rechners, mit
Folge und Fortschrittsbalken. Ein Tipp öffnet den Eintrag und spielt ihn an —
ohne aufzustehen. *Aktualisieren* holt die Liste neu; von selbst kommt sie beim
Verbinden.

Das Handy schickt dabei nie eine Adresse, sondern die Kennung eines Eintrags,
den ELFIX vorher selbst herausgegeben hat. Eine Kennung, die es hier nicht gibt,
öffnet nichts.

## Was hinausgeht und was nicht

| Vom Rechner zum Handy | Vom Handy zum Rechner |
| --- | --- |
| Titel, Folge, Stelle, läuft/pausiert | elf feste Befehlswörter |
| Weiterschauen: Titel, Folge, Fortschritt | die Kennung eines Eintrags daraus |

Mehr nicht. Kein Verlauf, keine Mediathek, keine Adresse. Bis 1.34.0 galt „wer
den Code hat, kann drücken, aber nicht mitlesen"; mit der Weiterschauen-Liste
stimmt das nicht mehr, und das soll hier auch so stehen: **wer den Code hat,
sieht, welche Serien angefangen sind.** Ausgesucht werden wollte vom Sofa aus,
und ohne Liste geht das nicht.

Was das Relay durchlässt, steht als feste Liste in `fern.js`: ein Wort, das dort
nicht steht, kommt gar nicht erst an. Die Liste selbst schaut es sich nicht an —
es kürzt sie nur auf vierzig Einträge und feste Felder.

**Der Code ist der einzige Zugangsschutz.** Acht Zeichen aus zweiunddreißig sind
vierzig Bit, und nach drei Fehlversuchen ist für diese Verbindung Schluss —
durchprobieren geht also nicht. Trotzdem gilt: läuft dein Relay über einen
Cloudflare Tunnel, ist `/fern` öffentlich erreichbar. *Fernbedienung erlauben*
auszuschalten nimmt jedem Handy die Möglichkeit, auch dem, das den Code kennt;
**Neuen Code erzeugen** löst alle gekoppelten.

Geht ELFIX aus, erfahren die Handys es und der Code koppelt niemanden mehr — die
Kopplung lebt nur, solange der Rechner da ist.

## Als App auf dem Startbildschirm

Dafür liefert das Relay vier Dinge mit: ein Manifest, zwei Symbole (192 und 512)
und einen Service Worker. Chrome bietet das Installieren nur an, wenn alle da
sind — und wenn die Seite über **https** kommt. Über den Cloudflare Tunnel ist
das erfüllt; über eine nackte IP im WLAN nicht.

> **Zuerst das Relay aktualisieren.** Diese vier Dinge kamen erst mit 1.34.0
> dazu. Die App aktualisiert sich von selbst, das Relay nicht — wer seine
> `.js`-Dateien zuletzt zu 1.33.0 kopiert hat, bekommt am Handy weiterhin eine
> Seite ganz ohne Manifest. Sie sieht gleich aus und die Fernbedienung
> funktioniert, aber Chrome legt davon nur eine **Verknüpfung mit Browserleiste**
> an und sagt nirgends, warum. Das ist der häufigste Grund, warum
> „Installieren" nicht geht.
>
> ELFIX prüft das selbst: unter *Einstellungen > Fernbedienung* steht eine Zeile
> **Relay**, sobald etwas im Weg ist — „zu alt zum Installieren", „nicht
> erreichbar" oder „kein https". Steht dort nichts, ist drüben alles in Ordnung.
> Gefragt wird `/health`; der Eintrag `fernapp` in `features` sagt, dass die
> ausgelieferte Seite Manifest, Symbole und Service Worker mitbringt.

Fehlt eine Bedingung, bekommt man eine Verknüpfung mit Browserleiste statt einer
App. Chrome nennt seine Gründe dafür nur in der Entwicklerkonsole, und da kommt
am Handy niemand hin — darum fragt die Seite jede Bedingung selbst ab. Unter
**Warum geht „Installieren" nicht?** steht dann Zeile für Zeile, was erfüllt ist
und was nicht:

| Zeile | Woran es liegt, wenn sie rot ist |
| --- | --- |
| Sichere Verbindung (https) | Die Seite kam über `http` — eine nackte IP im WLAN. Über den Tunnel öffnen |
| Browser kann Apps installieren | Ein Browser ohne Service Worker, oder ein privates Fenster |
| Service Worker läuft | Er wurde abgewiesen; die Meldung steht dabei |
| Manifest / Symbole erreichbar | Das Relay ist zu alt — `.js`-Dateien nachkopieren. Ist es *sehr* alt, fehlt diese Auskunft ganz: sie steht selbst in der Seite, die von dort kommt |
| Chrome bietet das Installieren an | Alles andere grün und trotzdem nichts? Dann hat Chrome die Seite schon einmal installiert oder das Angebot ist noch unterwegs |

Die Auskunft steht nur da, solange das Installieren nicht geht. Kommt das
Angebot doch noch, verschwindet sie von selbst.

Der Service Worker hält die Seite vor, aber nur als Rückfall: geladen wird immer
erst aus dem Netz. Nach einem Aktualisieren des Relays steht damit sofort die
neue Fassung da statt wochenlang die alte. Ohne Verbindung öffnet die
Fernbedienung trotzdem und sagt selbst, dass gerade nichts geht.

Symbole und Seite liegen als Zeichenketten in `.js`-Dateien (`fern-seite.js`,
`fern-icon.js`). Auch das folgt der Regel für Relay-Updates: kopiert werden nur
`.js`-Dateien, und ein Startbildschirm-Symbol, das ins Leere zeigt, fällt erst
auf, wenn jemand sein Handy neu einrichtet.

Im Manifest stehen `start_url`, `scope` und die Symbolpfade **relativ**. Der
Browser löst sie gegen die Adresse des Manifests auf, und damit stimmen sie auch
dann, wenn das Relay nicht an der Wurzel einer Domain hängt, sondern hinter
einem Vorspann wie `/elfix/`. Stünde dort `/fern/`, ließe Chrome sich zwar noch
installieren, aber die installierte App öffnete eine 404-Seite. Eine feste `id`
gibt es aus demselben Grund nicht — Chrome leitet sie aus `start_url` ab.
