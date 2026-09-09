# Gelernte Gewohnheiten: Intro und Fassung

Zwei Funktionen, die dasselbe Prinzip teilen: ELFIX rät nichts, sondern lernt
aus dem, was du selbst tust — und greift nie ungefragt ein.

## Intro überspringen

Ein Intro lässt sich hier nicht *erkennen*: ELFIX sieht das Video nie, es liegt
im Rahmen des Hosters. Also andersherum — gelernt wird aus den eigenen
Sprüngen.

Wer eine Serie schaut, spult das Intro selbst weg, jede Folge an derselben
Stelle. Der Player meldet Anfang und Ziel eines Sprungs auf die Sekunde genau;
das ist das Einzige, was ELFIX von einem Intro je erfahren kann. Springst du in
**zwei verschiedenen Folgen** derselben Staffel ähnlich — Beginn innerhalb von
zwölf Sekunden, Länge innerhalb von sechs —, entsteht daraus eine Marke, und ab
der nächsten Folge steht an dieser Stelle ein Knopf.

Gesprungen wird nur, wenn du ihn drückst. Aus demselben Grund, aus dem die
Bildstufe nur einmal je Folge gesetzt wird: ein Skript, das ungefragt eingreift,
ist eine Bevormundung — und ein falscher Sprung kostet neunzig Sekunden
Handlung, die man erst wiederfinden muss.

Was dabei gilt:

| Regel | Warum |
| --- | --- |
| Nur Sprünge nach vorn, 20 bis 180 Sekunden | kürzer ist ein Verspieler, länger keine Titelmelodie |
| Nur in den ersten zehn Minuten | was später übersprungen wird, ist Handlung |
| Zwei verschiedene Folgen nötig | ein einzelner Sprung kann Langeweile gewesen sein |
| Je Folge zählt der letzte Sprung | wer nachjustiert, hat einmal übersprungen, nicht dreimal |
| Je Titel **und Staffel** | Intros wechseln zwischen Staffeln |
| Während einer Watchparty wird nicht gelernt | dort zieht der Host den Player, das ist nicht die eigene Entscheidung |

Ändert sich das Intro mitten in der Serie, zieht die Marke nach: gerechnet wird
der Median der größten übereinstimmenden Gruppe, nicht der Durchschnitt über
alles. Ein einzelner Ausreißer verzieht sie damit nicht.

Der eigene Knopf zählt nie als Beleg. Lernte die Marke von sich selbst,
verschöbe sie sich mit jedem Druck ein Stück weiter.

Ab- und wieder anschalten unter *Einstellungen > Wiedergabe*; dort steht auch,
für wie viele Serien schon etwas gelernt wurde, samt **Vergessen**. Die Marken
liegen in `marken.json` im Datenordner und gelten nur für dieses Gerät — über
*Meine Geräte* wandern sie (noch) nicht mit.

Abspanne bleiben außen vor: was am Ende einer Folge zu tun ist, weiß ELFIX
längst — dort steht der Knopf zur nächsten Folge, mit Zähler.

> Im eigenen Player kommen dazu **öffentliche Skip-Daten** für Intro, Rückblick,
> Abspann und Vorschau, die in der Zeitleiste farbig markiert werden. Das ist
> ein getrenntes System und in [`SKIP-SEGMENTE.md`](SKIP-SEGMENTE.md)
> beschrieben.

## Fassung merken (Sub/Dub)

AniWorld und S.to legen jede Folge mehrfach ab — einmal je Synchronfassung.
Welche man bekommt, entscheidet die Reihe kleiner Flaggen über der Hosterliste,
und die steht bei jeder neuen Folge wieder auf der Vorgabe des Anbieters. Wer
eine Serie mit Untertiteln schaut, klickt das zwanzig Mal.

Also dasselbe Verfahren wie beim Intro:

- **Die erste Folge** sagt, womit du angefangen hast. Was beim Laden dasteht,
  wird gemerkt — aber nur, solange für diesen Titel noch nichts bekannt ist.
- **Ab der zweiten** klickt ELFIX die Flagge an, bevor der Hoster geladen wird.
  Kurz steht dann *„Japanisch, Deutsche Untertitel vorgewählt"* im Bild.
- **Klickst du selbst eine andere an**, gilt ab dann die. Nur ein echter Klick
  zählt als Entscheidung — der eigene Klick der Vorwahl trägt `isTrusted` nicht
  und lernt deshalb nichts von sich selbst.

Die Reihenfolge ist der eigentliche Punkt: die Anbieterseite zeigt nur die
Hoster der gewählten Fassung. Wer davor auf einen Hoster klickt, startet die
falsche und merkt es erst am Ton. Der Autostart wartet deshalb, bis die Fassung
steht — höchstens vier Sekunden, und nur, wenn überhaupt etwas umzustellen ist.

Gibt es die gemerkte Fassung bei einer Folge nicht — eine Staffel, die nur
untertitelt vorliegt —, bleibt stehen, was der Anbieter anbietet. Etwas anderes
anzuklicken wäre schlechter als nichts zu tun.

Gemerkt wird der Titel, nicht die Adresse: ein Anbieterumzug nimmt die Fassung
mit. Erkannt wird sie über die Angabe der Seite (`data-lang-key`) und den
Dateinamen der Flagge — der Schlüssel ist eindeutig, der Dateiname überlebt den
Umzug.

Ab- und wieder anschalten unter *Einstellungen > Wiedergabe*; dort steht auch,
für wie viele Serien etwas gemerkt ist und in welchen Fassungen, samt
**Vergessen**. Die Angaben liegen in `fassungen.json` im Datenordner und gelten
nur für dieses Gerät.

## Untertitelspur

Im eigenen Player wird zusätzlich die ausdrückliche Untertitelwahl gespeichert —
anhand von Sprache und Bezeichnung, nicht anhand einer wechselnden Spurnummer.
Sprachcode-Aliase und regionale Varianten werden berücksichtigt. Eine fehlende
Sprache löscht die Präferenz nicht; „Aus" bleibt ausgeschaltet.
