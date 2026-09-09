# Meine Geräte

Watchparty verbindet Menschen. **Meine Geräte** verbindet die Geräte *einer*
Person: was am Rechner geschaut wird, steht auf dem Laptop in *Weiterschauen* an
derselben Stelle. Es gibt nichts einzustellen und nichts beizutreten — wer
denselben Schlüssel trägt, hat denselben Stand.

## Einrichten

Unter *Einstellungen > Meine Geräte*:

1. Auf dem ersten Gerät **Neuen Schlüssel erzeugen**. Es kommt etwas heraus wie
   `T5M3BQS8-4FDBBB8N-5QQ2YME2-05T7R6SY`.
2. Auf jedem weiteren Gerät denselben Schlüssel eintragen und **Übernehmen**
   drücken. Groß- und Kleinschreibung, Striche und Leerzeichen sind egal; `I`
   und `L` gelten als Eins, `O` als Null — genau die Verwechslungen, die beim
   Abschreiben vorkommen.

Der Schlüssel ist zugleich der Schalter: wer ihn einträgt, will den Abgleich.
*Dieses Gerät trennen* nimmt ihn wieder heraus — die Einträge bleiben stehen,
sie gleichen sich nur nicht mehr ab.

Gebraucht wird dasselbe Relay wie für die Watchparty; die Adresse steht dort.
Eingeschaltet sein muss die Watchparty dafür **nicht** — die eigenen Geräte
sollen zusammenbleiben, auch wenn gerade niemand mit anderen schaut.

Die Geräteübersicht zeigt Namen, Gerätetyp und Verbindungsstatus. Dafür müssen
auch das Relay und die beteiligten Geräte aktuell sein.

## Was abgeglichen wird

Folge, Stelle, Fortschritt, abgeschlossene Titel und Folgen, Watchlist und die
Reihenfolge in der Mediathek. Gelöschtes verschwindet überall.

Dazu die gemessene Wiedergabezeit: *Rückblick* und *Wrapped* zählen auf jedem
Gerät alles zusammen. Wer abends am Rechner und am Wochenende auf dem Laptop
schaut, sähe sonst zweimal die halbe Bilanz. Eine Sitzung ist dabei ein Ereignis
und kein Zustand — sie kommt dazu oder sie ist schon da, überschrieben wird nie.
Die gerade laufende bleibt, wo sie ist, bis sie zu Ende ist.

## Was nicht

Selbst gewählte Titelbilder (sie liegen als Data-URL vor und sind um ein
Vielfaches größer als alles andere zusammen) und der Verlauf je Eintrag —
beides bleibt auf dem Gerät. Einträge einer Watchparty bleiben außerdem bei
ihrem Raum: dort werden sie ohnehin abgeglichen, und zwei Wege für denselben
Stand würden einander überholen.

Auch die Anbieteradresse ist Sache des einzelnen Geräts, ebenso die gelernten
Intro-Marken (`marken.json`) und gemerkten Fassungen (`fassungen.json`).

Fällt etwas auseinander, gilt der neuere Stand — dieselbe Regel wie in der
Watchparty. Gerechnet wird dabei in der Zeit des Relays, nicht in der des
Geräts: zwei Rechner sind sich über die Uhrzeit selten einig.

## Was das Relay dabei sieht

Nichts von dem, was dort steht. Aus dem Schlüssel fällt dreierlei, und nur das
Erste und die Kennungen gehen hinaus:

| Ableitung | wozu | beim Relay sichtbar |
| --- | --- | --- |
| Raumkennung | wo die Einträge liegen | ja, 32 Hexzeichen |
| Eintragskennung | welcher Eintrag welcher ist | ja, ein HMAC je Titel |
| Chiffre | AES-256-GCM | nein, nie |

Der Schlüssel selbst verlässt das Gerät nie. Ein Eintrag ist verschlossen, bevor
er hinausgeht; die Kennung ist ein HMAC und keine Prüfsumme, aus ihr lässt sich
also kein Titel zurückrechnen. Sichtbar bleibt, wie viele Einträge es gibt und
wann sie sich ändern.

Das ist der Unterschied zur Watchparty, und er ist beabsichtigt: dort muss der
Raum die Titel kennen, um sie anzuzeigen. Hier liest ohnehin nur der Besitzer.

Wer den Schlüssel hat, ist die Person. Er gehört nicht in einen Chat.
