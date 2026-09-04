# Die Schicht ueber dem Video pruefen - ohne Fernseher

`Werbeschichten.fremdSkript()` laeuft in **jedem** Dokument, das nicht dem
Anbieter gehoert - also auch im Rahmen des Hosters, und dort steht das Video.
Ein Fehlurteil faellt dem Benutzer nicht als Werbung auf, sondern als schwarzes
Bild. Genau deshalb gibt es diese Probe: eine Regel, die man nur auf einem
Fernseher ausprobieren kann, wird nicht ausprobiert.

## Aufruf

    android/schichtprobe/lauf.sh

Zwei Schritte, beide ohne Netz und ohne SDK:

1. **Die Skripte herausschreiben.** `Werbeschichten.java` wird mit `javac`
   gegen einen handgeschriebenen Android-Rumpf uebersetzt (vier Namen reichen),
   und ein kurzes Hauptprogramm legt beide fertigen Skripte als Datei ab - das
   der Rahmen und das der Anbieterseite. `node --check` sagt danach, dass sie
   ueberhaupt gueltiges JavaScript sind - im WebView eines guenstigen
   Fernseh-Sticks waere ein Syntaxfehler still. Gelaufen wird nur das Skript
   der Rahmen; das volle wird gelesen, nicht gefahren.
2. **Es laufen lassen.** `probe.js` baut mit `dom.js` ein Dokument nach - so
   viel DOM, wie das Skript anfasst, mehr nicht - und prueft beide Haelften:
   die Werbung, die verschwinden muss, und den Player, der bleiben muss.

## Was hier steht und warum

Die Faelle kommen aus zwei Fotos vom Fernseher (2.9.2026):

* ein Kasten neben dem laufenden Film: "Herzlichen Glueckwunsch!", ein Zaehler
  auf 00:22, "Fordern Sie Ihren Bonus an!"
* eine Flaeche ueber dem Film: "BESTAETIGEN SIE, DASS SIE KEIN ROBOTER SIND",
  ein nachgemaltes reCAPTCHA, "Weiter"

Dazu die Gegenprobe, ohne die die Reparatur eine Verschaerfung waere: der
Player, seine Bedienleiste, die Qualitaetswahl, ein echtes reCAPTCHA, ein
echtes Turnstile und der eingebettete Rahmen einer Zwischenseite der
Hosterkette bleiben stehen.

Und der Fall vom 4.9.2026 - "am Fernseher sind manchmal noch Werbung-Overlays
ueber dem Video": eine Schicht, die beim Laden schon im Dokument steht und erst
in der zwanzigsten Minute sichtbar geschaltet wird. Der Beobachter des Skripts
kann sie bauartbedingt nicht sehen (es wird nie ein Knoten eingehaengt), und
die beiden Nachschauen der ersten Sekunden sind laengst vorbei. Dafuer laeuft
jetzt eine Nachschau im Takt weiter.

## Was es nicht ist

Kein Ersatz fuer das Geraet. `dom.js` ist ein Nachbau, kein Browser: es kennt
kein Layout, und was es von Zeit kennt, ist eine Uhr zum Drehen -
`welt.vorspulen(ms)` laesst die Zeitgeber des Skripts laufen, damit sich die
Nachschau ueberhaupt pruefen laesst. Ein gruener Lauf sagt, dass die
Entscheidungen stimmen - nicht, dass das Video laeuft.
