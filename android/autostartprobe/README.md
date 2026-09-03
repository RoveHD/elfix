# Die Abkuerzung des Autostarts pruefen - ohne Geraet

Zwischen "Folge geoeffnet" und "Player da" wartet der Autostart auf einen
Player, den die Seite von sich aus einbettet. Die Frist dafuer sind zwoelf
Sekunden. Seiten, die grundsaetzlich keinen einbetten, warteten sie jedes Mal
vollstaendig ab, bevor der Klick auf die Hosterliste kam - gemessen am
2026-09-03 auf dem Telefon:

    Filmo     "Autostart begin" -> "nothing embedded"        12,2 s
    AniWorld  "Autostart begin" -> "player the page embeds"   0,5 s

`HOSTERLISTE_STATT_PLAYER_JS` beantwortet die Frage, die diesen Unterschied
ausmacht: *kann von dieser Seite ueberhaupt noch ein Player kommen?* Antwortet
sie mit einer Hosterliste, wird geklickt statt weiter gewartet.

## Aufruf

    android/autostartprobe/lauf.sh

Zwei Schritte, beide ohne Netz, ohne SDK und ohne `node_modules`:

1. **Die Probe herausschreiben.** Anders als bei `schichtprobe` wird hier nicht
   uebersetzt - `MainActivity` zieht das halbe Android-SDK nach sich, und was
   geprueft werden soll, ist ein Zeichenketten-Literal. Es wird deshalb aus dem
   Quelltext geschnitten, wie `tests/adblocktest.js` es mit den
   Entscheidungsfunktionen aus `main.js` macht. `node --check` sagt danach, ob
   es ueberhaupt gueltiges JavaScript ist; im WebView waere ein Syntaxfehler
   still, und still hiesse hier: die Abkuerzung greift nie und niemandem faellt
   es auf.
2. **Sie laufen lassen.** `probe.js` baut die Anbieterseiten nach - so viel
   DOM, wie die Probe anfasst - und prueft beide Richtungen.

Das Dokument kommt aus `../schichtprobe/dom.js`; zwei Nachbauten desselben
DOM waeren zwei Fassungen derselben Abkuerzungen.

## Warum beide Richtungen

Ein Fehlurteil ist hier in beide Richtungen teuer, und zwar unterschiedlich:

- **Zu frueh geklickt** kostet den Klick. Diese Seiten geben den ersten gern an
  ein Popunder, und auf AniWorld schickt er den Hauptrahmen auf die Domain des
  Hosters - danach ist die Seite keine Folgenseite mehr. Deshalb warten alle
  Faelle, in denen noch etwas kommen kann: ein Rahmen ab 120x80, ein laufendes
  Video, eine Seite ohne jede Hosterliste.
- **Zu spaet geklickt** sind die zwoelf Sekunden wieder da, um die es geht.

Die Schwelle von 120x80 ist der Grund, aus dem die Probe nicht einfach "gibt es
irgendeinen Rahmen" fragt: auf diesen Seiten liegen reichlich Zaehlpixel von
1x1, und ein einziges davon haette die Abkuerzung fuer immer verstellt. Sie
liegt zugleich deutlich unter den 200x150 von `PLAYER_PROBE_JS` - ein Rahmen
dazwischen heisst "die Seite baut gerade", und dann wird gewartet.

Die eigentliche Trennung leistet aber nicht diese Probe allein, sondern die
Schonfrist davor (`AUTOSTART_EMBEDDED_GRACE_MS`): gefragt wird erst, wenn ein
Player laengst dastehen muesste.
