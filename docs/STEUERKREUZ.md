# Das Steuerkreuz am Fernseher

Vier Richtungen und OK — mehr hat eine Fernbedienung nicht, und damit muss
jede Stelle der App erreichbar sein. Dieses Dokument sagt, nach welchen Regeln
der Fokus wandert, warum es diese Regeln sind und wo sie im Quelltext stehen.

Nicht gemeint ist hier das Handy als Fernbedienung — das steht in
[FERNBEDIENUNG.md](FERNBEDIENUNG.md).

## Die zwei Regeln

**Links und rechts bleiben in der Reihe.** Am Ende einer Reihe ist Ende. Wer
die Reihe wechseln will, drückt nach unten.

**Oben und unten halten die Spalte.** Wer bei der vierten sichtbaren Kachel
nach unten drückt, landet unter ihr — und nicht am Anfang der nächsten Reihe.

Gemessen wird dafür die Mitte auf dem Bildschirm und nicht die Nummer der
Kachel: Reihen sind unterschiedlich weit geschoben, und was zählt, ist das,
was man sieht.

### Warum das eine Reparatur ist und keine Geschmacksfrage

Gemeldet war: „nicht automatisch Reihe nach unten wechseln, wenn man am Ende
nach rechts drückt". Der Sprung ging dabei nicht an den Anfang der nächsten
Reihe, sondern mitten hinein — auf die siebte Kachel, auf die zwölfte, auf
irgendeine. Das sah nach Zufall aus, war aber folgerichtig.

Die Fokussuche von Android schaut sich alle Ziele der ganzen Seite an und nimmt
das, was am besten „rechts" liegt. Jede Reihe ist aber ein waagerechter
Schieber: ihre Kacheln liegen vollständig nebeneinander, auch die, die gerade
nicht zu sehen sind. Die unsichtbare zwölfte Kachel der nächsten Reihe liegt
damit tatsächlich weit rechts — weiter rechts als alles in der eigenen Reihe.
Also gewann sie.

Deshalb entscheidet die Reihe jetzt selbst, was links und rechts bedeutet, und
die Seite redet nicht mehr mit.

## Wo das steht

| Datei | Was sie tut |
| --- | --- |
| `Fokusreihe.java` | Die Reihe selbst: sie fängt links und rechts ab und hält beim Wechsel nach oben oder unten die Spalte |
| `Reihenfokus.java` | Die Rechnung dahinter — ohne Ansichten, damit sie ohne Fernseher prüfbar ist |
| `TvViews.reihe(...)` | Baut jede waagerechte Reihe der App als `Fokusreihe`. Deshalb gilt die Regel überall und nicht nur auf der Startseite |
| `MainActivity` (Entdeckungsraster) | Dasselbe im Raster: an der linken und rechten Kante wechselt die Taste die Zeile nicht mehr |

Geprüft wird die Rechnung in `ReihenfokusTest`. Alles, was einen Bildschirm
braucht, lässt sich dort nicht prüfen und gehört auf ein Gerät — die
Abgrenzung ist dieselbe wie bei den übrigen Java-Prüfungen (siehe
`android/jvmprobe/README.md`).

### Die Knopfleiste der Kopfzeile

Sie ist ebenfalls eine `Fokusreihe`, aber ohne Spaltenregel: rechts neben
„Einstellungen" ist Schluss, statt dass der Fokus in die Seite darunter fällt.
Die Spalte zu halten wäre hier falsch — die Leiste steht rechts ausgerichtet,
und unter ihrem letzten Knopf liegt nicht der Anfang der Seite, sondern deren
rechter Rand.

### Die Überschrift einer Reihe

Der Knopf rechts in der Überschrift („Alle anzeigen", „Mehr anzeigen") ist ein
eigenes Fokusziel und liegt **vor** seiner Reihe: von oben kommend landet man
zuerst dort und geht mit unten in die Kacheln. Das ist Absicht und
unverändert — ohne ihn wäre der Knopf nur über die Kacheln erreichbar.

## Die Kopfzeile bleibt stehen

Nach unten aus der Kopfzeile heraus klappt sie sich ein — aber nur auf einer
Anbieterseite. Dort kostet sie Bild, und alles, was sie bietet, hat eine Taste
auf der Fernbedienung.

Auf den eigenen Seiten war dasselbe Verhalten ein Fehler: wer auf der
Startseite von „Suche" nach unten drückte, verlor die ganze Kopfzeile. Am
Fernseher heisst das: kein Weg mehr zu Suche, Favoriten, Watchparty und
Einstellungen, bis man die Seite neu aufruft. Eingeklappt wurde sie, weil
dahinter eine Anbieterseite vermutet wurde; auf der Startseite gibt es keine,
und so blieb sie weg, ohne dass etwas an ihre Stelle trat.

## Wo der Fokus anfängt

Nach jedem Aufbau einer Seite sucht `tvFokusHerstellen` der Reihe nach:

1. den gemerkten Platz dieser Seite — wer zurückkommt, soll dort stehen, wo er
   war,
2. einen bekannten ersten Platz (Titelbild, Anbieterkachel, Reiter …),
3. und zuletzt das erste Fokusziel der Seite überhaupt.

Der dritte Punkt ist neu und der Grund dafür ebenso: eine Startseite ohne
Titelbild und ohne Anbieterreihe fängt mit „Weiterschauen" an, und diese Marke
steht nicht in der Liste. Ohne diesen Ausweg stand der Fokus nirgends — und
eine Fernbedienung ohne Fokus tut beim ersten Druck gar nichts.

## Was die Startseite damit zu tun hat

Zwei Reihen standen dort im Weg, und beide kosteten jedes Mal Blätterweg.

**Die Anbieter** haben eine eigene Seite bekommen: am Fernseher den Knopf
„Anbieter" in der Kopfzeile, auf dem Telefon den oben rechts. Auf der
Startseite stehen sie nur noch, wenn man sie bestellt — der Schalter heisst
*Einstellungen → Startseite → Deine Anbieter* und beginnt aus. Drei Kacheln,
die sich nie ändern, mitten zwischen dem, was läuft, und dem, was
vorgeschlagen wird, waren eine Reihe, durch die man immer hindurchblättert.

**Der Rückblick** steht jetzt zuletzt. Er sass zwischen Mediathek und
Vorschlägen — im Dezember auch dann, wenn er abgeschaltet war, denn der
Jahresrückblick blendet sich in seiner Saison von selbst ein. Mitten in der
Seite war das eine Karte, die niemand bestellt hatte und die alles darunter um
eine Bildschirmhöhe nach unten schob. Die Dezember-Regel bleibt; sie steht nur
nicht mehr im Weg.

## Gleich hohe Karten

Gemeldet: „die Karten sind unterschiedlich hoch, je nachdem wie lang der Titel
ist". Sie waren es zwangsläufig. Eine Karte wächst mit ihrem Inhalt — drei
Zeilen Titel statt einer, eine Unterzeile, die umbricht, die Zeile aus der
Runde, die nur bei manchen dasteht. Nebeneinander ergab das eine Reihe mit
ausgefranster Unterkante.

Das entscheidet jetzt die Reihe und nicht die Karte: jede Karte bekommt
`MATCH_PARENT` als Höhe (`TvViews.reihe`, `MobileViews.reihe`, und beim
Nachlegen `TvViews.kachelAnhaengen`). Eine waagerechte `LinearLayout` vermisst
damit zuerst alle Karten, nimmt die höchste und zieht die übrigen genau darauf
(`forceUniformHeight`). Das ist ausdrücklich keine feste Höhe: die Reihe ist so
hoch, wie ihre höchste Karte sein muss, und keine Zeile mehr. Die Breite bleibt
Sache der Karte.

Der Text bleibt dabei oben am Poster; freier Platz fällt unten an. Das Raster
der Entdeckungsseite hatte das Problem nie — dort gibt die Zelle die Höhe vor.
