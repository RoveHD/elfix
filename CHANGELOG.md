# Changelog

Alle Versionen von ELFIX, neueste zuerst. Die Eintraege stammen aus den
Release-Commits - was dort steht, ist auch tatsaechlich in der Version drin.

## 1.57.0 — 28. August 2026

„Gemeinsam weiterschauen" blieb auf Android leer.

Kein Anzeigefehler. Beide Seiten zeigen dieselbe Bedingung — Einträge, die zu
einer Runde gehören —, aber einen solchen Eintrag hat auf Android nie jemand
angelegt. Am Rechner entsteht er, sobald der Stand eines Mitglieds hereinkommt;
die Regel dafür lag aber in einer Datei, die das Telefon nie sieht. Androids
Gegenstück stieg an derselben Stelle wortlos aus. Füllen konnte die Reihe
deshalb nur, wer einen Titel ausdrücklich über die Watchparty-Seite öffnete.

Nachgestellt mit einem echten Relay und einem zweiten Mitglied, das im
Sekundentakt meldet: Android trat dem Titel bei, das Relay leitete weiter — und
nach zwanzig Sekunden stand in der Ablage kein einziger Eintrag mit Raum, der
eingestellte Titel gar nicht.

Die Regel steht jetzt im geteilten Modul, das beide Seiten benutzen. Sie sucht
über Serie **und** Raum: ein Titel kann privat laufen und zugleich in zwei
Runden stehen, und die drei Stände haben nichts miteinander zu tun. Der eigene
Eintrag wird dabei nie angefasst — vorher hätte Android den fremden Stand in den
privaten Verlauf geschrieben.

Am Gerät nachgeprüft: der Eintrag entsteht, trägt seinen Raum, die richtige
Folge und die Stelle des anderen — und die Reihe steht auf der Startseite.

## 1.56.0 — 28. August 2026

YouTube zählte als Serie mit — und eine Zeile in der Statistik hatte kein Bild.

**YouTube.** Die Gattungsbestimmung kannte Film, Anime und Serie; alles andere
fiel auf „Serie". Ein Reaktionsvideo von einer Stunde lief damit in dieselbe
Rechnung wie eine Serienfolge. In echten Zahlen: 2 von 224 Sitzungen, aber eine
von siebzehn Stunden — 5,9 % der gemessenen Zeit. Das Video stand in „Deine
meistgesehenen Serien" und verschob Gesamtzeit, Genres, Folgenzahl, stärksten
Tag und die Serie des Jahres.

YouTube ist jetzt eine eigene Gattung und wird **vor** jeder Zählung
herausgenommen, nicht erst bei der Anzeige. Was es betrifft, steht als eigener
Abschnitt daneben: Zeit, Anzahl, Tage und eine kleine Bestenliste. Bewusst
knapp — Genres, Strecken und ein „Video des Jahres" geben die Daten nicht her.
Darunter steht ein Satz, dass diese Zeit in keiner Zahl darüber enthalten ist;
sonst sucht man seine Stunde vergeblich und hält die Statistik für kaputt.

Erkannt wird an Adresse und Anbieter, nicht an der abgelegten Gattung: alte
Sitzungen tragen „serie" und zählen trotzdem als Video. Umgeschrieben wird
nichts, es wird nur richtig gelesen. Aus 17,00 h werden damit 15,98 h regulär
und 1,01 h YouTube daneben. Android bekommt dasselbe — es rechnet mit
demselben Modul.

**Das fehlende Bild.** Ohne Bild entstand gar kein Element, und die Zeile
verlor ihren Bildplatz: Titel und Anbieter rutschten nach links und standen auf
einer Linie. Der Grund ist harmloser, als er aussieht — die Zeile kommt aus den
Sitzungen, das Bild aus der Ablage. Wer einen Titel aus der Mediathek löscht,
behält seine Sitzungen; die Statistik vergisst nichts. Dann gibt es eben kein
Bild mehr. Jetzt steht dort derselbe gestaltete Platzhalter wie auf den Karten,
und ein Bild, das sich nicht laden lässt, fällt genau einmal darauf zurück.

**Der Geräteabgleich** rechnet richtig zusammen — nachgesehen, nicht vermutet:
keine doppelten Sitzungen, keine Überschneidungen. Eine Folge zählt einmal, auch
wenn sie über zwei Geräte lief; die Zeit addiert sich, weil die Sätze
verschiedene Stücke abdecken.

## 1.55.1 — 28. August 2026

Nachtrag zu 1.55.0: die Startseite konnte in der falschen Reihenfolge
stehenbleiben.

Der Vergleich, der die dauernden Neuaufbauten beendet hat, sah auf die
Einträge — aber nicht darauf, in welcher Reihenfolge die Startseite sie zeigt.
Die hängt an Zeitstempeln, und die wandern weiter, ohne dass sich am Eintrag
selbst etwas ändert. Eine Kachel, die nach vorn gehört hätte, blieb deshalb
stehen, bis irgendetwas anderes ein Zeichnen erzwang.

Verglichen wird jetzt das Ergebnis der Sortierung statt ihrer Eingabe: eine
neue Zeit zählt nur, wenn sie wirklich etwas verschiebt. Dazu drei Felder, die
auf den Karten stehen und im Vergleich fehlten — Anbietername, die Beschriftung
neuer Folgen und die Gesehen-Marke.

## 1.55.0 — 28. August 2026

Die Oberfläche baute sich ständig selbst neu — auf dem Telefon, am Fernseher
und am Rechner.

Gemeldet war das Zucken: Bereiche, die sich neu aufbauen, Bilder, die kurz
verschwinden und wieder laden, springende Listen. Zuerst gemessen, dann
geändert.

**Auf dem Telefon**, erste 45 Sekunden nach dem Start: acht komplette
Neuaufbauten der Startseite, fünf davon in 3,4 Sekunden. 569 Bild-Ladeaufträge
für 108 verschiedene Bilder — eines allein vierzehnmal. Und 279 abgelegte
Bilder, von denen 235 sofort wieder verdrängt wurden.

Fünf Ursachen. Jede fertige Vorschlagsreihe baute die ganze Seite neu; jetzt
werden Meldungen in einem Fenster von 180 ms gesammelt und ergeben ein
Zeichnen. Die Watchparty-Seite entstand bei jeder Meldung des Relays neu — bei
zwei Teilnehmern alle paar Sekunden; jetzt nur, wenn sie danach anders aussähe.
Der Titelhintergrund warf alle fünfzehn Sekunden seinen ganzen Kasten weg,
samt Bild; jetzt wird umgeschrieben, was anders ist. Ein Bild, das schon da
steht, wird nicht mehr erst gelöscht und dann neu geholt. Und der Bildspeicher
ist von einem Achtel auf ein Viertel gewachsen, weil er sich sonst selbst
leerräumte.

Danach: fünf Neuaufbauten statt acht — die übrigen sind echte neue Inhalte —
und 182 Ladeaufträge statt 569.

**Am Rechner** dasselbe Muster, anderer Takt: 253 ersetzte Bereiche in 45
Sekunden Leerlauf, jede Reihe elfmal, im Fünfsekundentakt. Der Hauptprozess
meldet seinen Stand, und jede Meldung war ein Neuaufbau — auch wenn sich an
keinem Eintrag etwas geändert hatte. Jetzt 92.

**Übergänge** gibt es erst danach, und das ist keine Reihenfolge aus
Bequemlichkeit: auf einem Fünfsekundentakt wäre jede Animation alle fünf
Sekunden neu angelaufen. Bewegt wird nur, was einen Wechsel bedeutet — eine
Ansicht, die aufgeht, eine Reihe, die zum ersten Mal etwas zu zeigen hat, ein
Knopf unter dem Finger. Beim Löschen blendet die Kachel aus und zieht sich
zusammen, und *dann* ändert sich die Ablage; vorher war der Eintrag weg, bevor
etwas zu sehen war. Wer „Bewegung reduzieren" eingestellt hat, bekommt nichts
davon.

**„Verlauf ansehen" fehlte** in der Mediathek bei jedem einzelnen Titel. Zwei
geteilte Dateien vergaben denselben Namen auf oberster Ebene, und weil die
Oberfläche sie als gewöhnliche Skripte lädt, brach die zweite beim Laden ab —
nicht die Zeile, die ganze Datei. In den Prüfungen fiel das nie auf: die laden
dieselben Dateien anders. Jetzt tun sie es so wie die Oberfläche. Filme bekommen
den Punkt ebenfalls wieder; sie haben keine Folgen, und die Bedingung war für
sie nie erfüllbar.

**Am Fernseher** blendete sich die Wiedergabeleiste im Vollbild nicht mehr aus.
Zwei Gründe, beide nachgestellt. Meldete der Player seine eigene Bedienleiste
als sichtbar, endete die Ausblendkette und lief nie wieder an. Und der Fokus
stand nach jedem Druck auf das Steuerkreuz auf dem Autoplay-Schalter — dem
einzigen Fokusziel im Vollbild —, und der Schutz „solange der Fokus darauf
steht, passiert nichts" hielt damit jeden Schritt auf. Beim Schauen drückt
niemand eine Taste, also blieb der Kasten bis zum Ende der Folge über dem Bild.
Jetzt tritt er auch mit Fokus zurück; ganz verschwinden darf er nur, wenn er
den Fokus nicht hält.

## 1.54.0 — 27. August 2026

„4 Mal abgeschlossen" stand da, dabei war die Serie nur vier Mal eingeholt.

Gemeldet an „BLACK TORCH": vier Serienabschlüsse, acht identische Zeilen für
Folge 8, mehrere Zeilen derselben Folge innerhalb weniger Minuten und nackte
„Abgeschlossen"-Einträge ohne jede Folgenangabe. In der echten Ablage standen
dort dreiunddreißig Ereignisse für acht Folgen.

**Die Duplikate.** Der Kasten hat nie einen Verlauf gezeigt, sondern ein
Ereignisprotokoll. Dort landet jede Meldung des Players, jedes Neuladen, jedes
erneute Öffnen; zusammengefasst wurde nur, wenn zwei gleiche Zeilen direkt
hintereinander standen. Das trifft im Betrieb selten zu — zwischen zwei
Meldungen zu Folge 8 liegt ein „Geöffnet", oder eine zweite Seite meldet
dazwischen Folge 4, und schon ist es eine neue Zeile.

Gezeigt wird jetzt, was daraus folgt: **je Staffel und Folge genau ein
Eintrag**, mit dem neuesten Zeitpunkt, dem höchsten Fortschritt und dem
Abschluss, falls diese Folge zu Ende lief. Staffel und Folge kommen dabei
ausschließlich aus der Adresse des Ereignisses selbst — nie aus dem Zeiger des
Eintrags, der längst woanders steht.

**Die vier Abschlüsse.** Ein Titel galt als durch, sobald die laufende Folge die
letzte war, die der Anbieter gerade hatte. Bei einer wöchentlich erscheinenden
Serie ist das keine feste Grenze: erreicht nach Folge 3, dann nach Folge 6, dann
zweimal nach Folge 8. Das waren keine vier Serienabschlüsse, sondern vier
konkrete Folgenabschlüsse und ein neu berechneter Zustand.

Der Zähler ist deshalb weg, ersatzlos. Aus diesen Daten lässt sich ein echtes
Wiederschauen nicht belegen, und eine Zahl, die man nicht belegen kann, gehört
nicht auf den Schirm. Ein Abschluss hängt jetzt immer an einer konkreten Staffel
und Folge; nackte „Abgeschlossen"-Zeilen entstehen für Serien gar nicht mehr.

Nebenbefund aus derselben Ecke: die **letzte Folge einer Serie** wurde nie als
abgeschlossene Folge vermerkt. Den Eintrag legt nur der Schritt auf eine nächste
Folge an, und den gibt es am Serienende nicht mehr. Bei BLACK TORCH standen
deshalb Folge 2 bis 7 in der Ablage — und Folge 8, die gemeinte, nicht.

**„Auf aktuellem Stand"** ist kein Ereignis, das man ablegen könnte. Es hängt
daran, was der Anbieter gerade hat und was AniList beziehungsweise TMDB über die
Serie sagen — und beides wusste ELFIX bisher nicht. Laufzustand, Folgenzahl und
nächste Folge kommen jetzt mit. Ein endgültiger Abschluss wird nie behauptet,
solange er nicht belegt ist: eine bekannte nächste Folge schlägt jeden
Statuseintrag, und „beim Anbieter kommt gerade nichts mehr" ist kein Beleg,
sondern der Normalzustand zwischen zwei Folgen. Fehlt die Auskunft ganz, steht
dort „Auf aktuellem Stand" oder gar nichts — nie ein Abschluss.

**Der Raum.** Der Fortschritt einer Runde landet im Eintrag, aber nie im
persönlichen Verlauf. Wer bis Folge 8 dabei war, während der Raum bis Folge 10
weiterschaute, hat Folge 8 im Verlauf und nicht Folge 10. War man dabei, steht
der Raum bei der Folge.

Der Kasten ist derselbe wie bisher, nur gegliedert: Staffeln als Überschrift,
die beim Scrollen oben stehen bleibt, darunter je Folge eine Zeile mit „Folge 8
· Abgeschlossen" oder „Folge 9 · 12:41 von 24:10". „An X Tagen geschaut" bleibt
und zählt eindeutige Kalendertage mit tatsächlicher Wiedergabe.

Migriert wird nichts und gelöscht wird nichts. Gerechnet wird bei jeder Anzeige
neu, aus den unveränderten Rohdaten.

## 1.53.0 — 27. August 2026

Ein dunkler Punkt klebte im Video, und der Knopf daneben ging nie ganz weg.

Zwei Meldungen, eine Ursache: die Wiedergabeleiste war sichtbar, solange
überhaupt eine Folge lief — auch dann, wenn beide Knöpfe darin verborgen waren.

**Der Punkt.** Übrig blieb in diesem Fall ihr eigener Hintergrund: ein
gerundeter Kasten ohne Inhalt, also ein dunkler Punkt unten rechts im Bild. Er
stand dort die ersten neunzig Prozent jeder Folge und war das Einzige, was von
der Leiste zu sehen war. Ein Behälter ohne Inhalt gehört nicht auf den Schirm —
steht weder „Nächste Folge" noch „Abbrechen", ist die Leiste jetzt weg statt
leer.

**Der Knopf.** Und wenn sie Inhalt hat, geht sie in drei Schritten statt in
zweien: voll da, nach fünf Sekunden zurückgetreten, nach zehn ganz weg.

Hier stand einmal das Gegenteil, und beides aus gutem Grund. Nach dreieinhalb
Sekunden ganz zu verschwinden war ein Fehler: auf dem Telefon lief eine Folge
bis zum Ende, ohne dass je ein Knopf zu sehen war. Die Antwort darauf — „sie
verschwindet nie", fest bei vierzig Prozent Deckkraft — war der nächste Fehler,
nur ein leiserer: ein Kasten, der eine Stunde lang halb durchsichtig über dem
Bild klebt, ist genau das, was beim Schauen stört.

Der Unterschied zum ersten Anlauf ist nicht die Zeit, sondern der Rückweg.
Damals gab es keinen. Heute holt jede Berührung und jede Taste die Leiste
zurück — dieselbe Geste, mit der man auch die Bedienleiste des Hosters wieder
hervorholt. Wer den Knopf sucht, tippt ohnehin ans Bild. Meldet der Player
selbst, dass seine Überlagerung steht, fängt sie ebenfalls wieder bei voll an.

Zwei Ausnahmen bleiben: während eines Zählers steht sie voll da (eine Ansage,
die sich wegduckt, ist keine), und solange der Fokus auf ihr liegt, rücken die
Schritte gar nicht erst weiter.

Auf beiden Emulatoren nachgesehen — auf dem Telefon mit Knopf, auf dem
Fernseher ohne: die drei Schritte kamen auf die Sekunde genau, an der Stelle des
Punktes steht nur noch Bild, und aus dem letzten Schritt heraus holt ein Druck
auf der Fernbedienung die Leiste zurück und setzt den Fokus hinein.

## 1.52.0 — 27. August 2026

Auf dem Telefon sah man beim Start einer Folge alles, was man nicht sehen soll.

Ein Tipp auf „Weiterschauen" hieß auf Android: die Anbieterseite baut sich auf,
die Hosterliste erscheint, die Überlagerung des Players blitzt kurz, das Bild
klappt ins Vollbild — und irgendwann läuft etwas. Am Rechner liegt vor genau
dieser Strecke seit jeher ein Vorhang. Auf Android gab es nur einen Hinweis
„Startet …".

Jetzt liegt der Vorhang auf beiden Geräten, und er zeigt **echte Schritte**:
*Folge wird geöffnet* (8 %), *Player wird geladen* (32 %), *Video wird
vorbereitet* (58 %), *Zur gespeicherten Stelle* (78 %), *Vollbild wird gesetzt*
(90 %), *Wiedergabe läuft*.

**Der Balken zählt keine Zeit hoch.** Ein Ladebalken, der das tut, sieht bei
einer Leitung, die dreißig Sekunden braucht, genauso aus wie bei einer, die drei
braucht — er wäre gelogen. Er springt nur, wenn ein Schritt wirklich hinter der
Startkette liegt, und steht sonst still. Rückwärts geht er nie. Ohne
gespeicherten Stand fällt „Zur gespeicherten Stelle" aus der Liste, statt als
Schritt dazustehen, den niemand je meldet.

Welche Schritte es gibt, wie sie heißen, wie voll der Balken dabei ist und wie
lange jeder dauern darf, steht **an einer Stelle** und gilt für Telefon,
Fernseher und Rechner gleichermaßen. Der Rechner bekommt damit denselben Balken
und dieselben Texte; sein Vorhang hatte bisher nur einen Spinner und einen Satz.

**Der Vorhang geht erst auf, wenn das Video wirklich läuft** — nicht, wenn die
Seite geladen ist. Er liegt über dem Seitenaufbau, über den Überlagerungen des
Hosters und über dem Wechsel ins Vollbild, und solange er liegt, gehören ihm
Finger und Fernbedienung: keine Taste erreicht ein Ziel, das man nicht sieht.

**Und wenn nichts kommt,** bleibt er nicht ewig liegen. Jeder Schritt hat seine
Frist, über allem steht ein Deckel von zweieinhalb Minuten. Läuft eine ab, wird
aus dem Ladebildschirm eine Ansage mit zwei Wegen: „Erneut versuchen" fährt
denselben Start noch einmal von vorn, „Zurück" gibt ihn auf. Der Text nennt den
Schritt, an dem es hängt — wer liest, dass der Hoster keinen Player geliefert
hat, weiß, dass ein zweiter Versuch etwas bringen kann.

Auf beiden Emulatoren durchgespielt, Handy und Fernseher mit D-Pad:
„Weiterschauen" startet die richtige Folge an der gespeicherten Stelle, beim
Aufziehen läuft das Video bereits im Vollbild, „Nächste Folge" ebenso. Acht
D-Pad-Tasten während des Vorhangs ließen den Bildschirm unverändert. Der
Fehlerfall wurde mit abgeschaltetem Netz geprüft, das Zeitlimit griff nach
genau neunzig Sekunden, und „Erneut versuchen" führte bis ins laufende Bild.

## 1.51.0 — 27. August 2026

Autoplay und „Nächste Folge" waren auf Android ein Element. Jetzt sind es zwei.

Beide saßen in derselben Zeile derselben Ansicht und teilten sich damit
zwangsläufig alles: Platz, Deckkraft, Sichtbarkeit. Zwei Bedienelemente mit zwei
Aufgaben können aber nicht eine Regel haben.

Sichtbar wurde es am Schalter. Die Leiste tritt im Vollbild nach fünf Sekunden
Ruhe auf 40 Prozent Deckkraft zurück, statt zu verschwinden — mit gutem Grund:
sie trägt den einzigen Weg zur nächsten Folge, und als sie das einmal nicht tat,
lief eine Folge bis zum Ende, ohne dass je ein Knopf zu sehen war. Für eine
*Einstellung* ist dieselbe Regel falsch. Halb durchsichtig auf dem Video ist sie
nur im Weg, und „durchsichtig" heißt in Android weiterhin: belegt Platz, nimmt
Fokus an, fängt Berührungen ab.

**Der Knopf** bleibt unverändert, wo er war — unten rechts über der Bedienleiste
des Hosters, ab neunzig Prozent, mit derselben Logik wie am Rechner. Er rührt den
Schalter nicht an.

**Der Schalter** liegt oben links und geht mit der Bedienleiste des Players:
steht sie, steht er; ist sie weg, ist er wirklich weg — nicht durchsichtig,
sondern aus dem Ansichtsbaum. Die eine Ausnahme ist der Zähler am Ende einer
Folge: während einer Ansage soll man den Automatismus abschalten können, ohne
erst das Bild antippen zu müssen.

Auf Telefon und Fernseher durchgespielt: bei stehender Bedienleiste beide
gleichzeitig, bei ausgeblendeter findet die Ansichtsprüfung „Autoplay" kein
einziges Mal mehr, während „Nächste Folge" weiter dasteht. Eine Berührung
beziehungsweise eine Taste holt beides zurück; umgeschaltet wird per Tipp und
per D-Pad, und der Fokus erreicht den Schalter nur, solange er da ist, und fällt
danach sauber ins Video zurück.

## 1.50.0 — 26. August 2026

Die Startseite von Handy und Fernseher — sie zuckte, und sie zeigte das Falsche
zuerst.

### Alle fünf Sekunden ein Sprung

Besonders, wenn man weiter unten gescrollt war. Das ist kein Zufall gewesen:
`bestandGeaendert` hat bei *jeder* Meldung aus dem Bestand die ganze Seite neu
gebaut und danach die Scrollstelle wiederhergestellt. Genau dieses Zusammen- und
Wiederaufklappen sieht man — und es fällt erst auf, wenn man nicht ganz oben
steht.

Aufgefallen ist es jetzt, weil Android seit 1.49.0 überhaupt wieder Fortschritt
bucht: der Messtakt meldet alle fünf Sekunden. Der Fehler ist älter, er hatte nur
nichts, was ihn auslöst.

Was so eine Meldung wirklich bringt, ist eine andere *Stelle* im laufenden
Titel — kein anderer Titel, keine andere Reihenfolge, keine andere Reihe. Dafür
muss keine Seite entstehen. Zusammengefasst wird jetzt, was auf den Kacheln zu
sehen ist und sich nicht im Sekundentakt bewegt: Einträge und ihre Ordnung,
Titel, Staffel und Folge, das Titelbild (es wird oft nachgereicht), ob einer auf
die nächste Folge wartet, und zu welcher Runde er gehört. Ist das gleich
geblieben, wird nicht neu gezeichnet.

Am Gerät nachgemessen, auf der Startseite und nach unten gescrollt: bei
derselben Folge nur weiter wird der Stand gebucht, ohne dass sich außerhalb der
Statusleiste ein einziger Pixel ändert; bei einer anderen Folge zeichnet die
Seite neu. Der Preis ist, dass Balken und Zeit auf der Kachel bis zum nächsten
echten Anlass stillstehen — kleiner als eine Seite, die im Fünfsekundentakt
springt, und die Kacheln einer Runde zieht ohnehin der Sekundentakt nach, ohne
die Seite anzufassen.

### Weiterschauen steht jetzt oben

Am Rechner stehen Neue Folgen, Weiterschauen und Gemeinsam weiterschauen ganz
oben; auf Telefon und Fernseher lagen sie hinter dem Anbieterrost und dem
Kalender. Beide Reihen gab es also längst und getrennt — man kam nur an drei
Reihen vorbei, bevor man weiterschauen konnte, und mit einer Fernbedienung ist
das jedes Mal ein Druck mehr.

Sie stehen jetzt direkt unter dem Titelbild, der Anbieterrost darunter. Er
bleibt, wo er inhaltlich hingehört — auf Telefon und Fernseher gibt es keine
Seitenleiste, und die Anbieter sind der Weg zu allem, was ELFIX nicht selbst
weiß —, nur nicht mehr vor dem, was gerade läuft.

## 1.49.0 — 26. August 2026

Zwei Meldungen von Android, und beide waren nicht das, wonach sie aussahen: die
eine war kein Popup, die andere war nicht „unzuverlässig", sondern nie.

### Die Karte oben rechts hatte ihre Merkmale hinter einer Dokumentgrenze

Gemeldet als „Popups und Weiterleitungen" auf Android TV. Was da erscheint, ist
weder das eine noch das andere: es ist ein Rahmen, den ein Werbeskript in die
Seite hängt — ohne src, ohne id, ohne Klasse, das einzige Attribut ist der Stil.
Er hängt an `<html>`, liegt fest in der Ecke und ganz vorn, und darin stehen
zwei „BROWSER-UPDATE"-Karten. Auf dem Fernseher und auf dem Telefon
gleichermaßen.

Warum ihn keine der vier vorhandenen Schichten gesehen hat, ist bei allen vieren
derselbe Grund: sie lesen das Element von außen, und von außen steht nichts
darauf. Kein Name für die Werbekennungen, kein Text für die Textmuster — der
Text liegt in seinem eigenen Dokument —, kein Ziel für die Domainlisten, und
weil es für `about:blank` keine Anfrage gibt, auch nichts für den Anfragefilter.
Die Punktevergabe kam auf zwei von vier, die geteilte Kosmetik verwarf ihn mit
14 Prozent Deckung als „zu klein".

Übrig bleibt genau ein Merkmal, das von außen sichtbar ist: der Rahmen hat keine
Quelle. Ein Player wird immer von einer Adresse geholt — gemessen
`aniworld.to/redirect/<id>` und `filmo.to/n/<id>`, beide mit src und beide im
Textfluss ihres Kastens. Ein Rahmen ohne Adresse ist keiner. Liegt er zusätzlich
fest und vor allem anderen, hat er keine andere Aufgabe, als auf der Seite zu
liegen.

Eng gehalten, damit die Regel den Player nicht mitnimmt: die Ebene muss
vierstellig sein, der Rahmen muss Fläche haben, und wer fast den ganzen Schirm
einnimmt, fällt heraus. Der Schutz steht unverändert davor — eine Verifizierung
bleibt auch dann stehen, wenn sie diese Form hätte.

Und ausdrücklich kosmetisch, nicht als Sperre: die Bilder kommen als
Seitenbestandteile herein, und ein Anfragefilter davor wäre genau das, was VOE
als Werbeblocker meldet. Was nie blockiert wird, kann kein Erkenner sehen — die
Folge lief beim Nachmessen in 1080p weiter.

### Weiterschauen funktionierte auf Android nicht selten, sondern nie

Auf einem frisch eingerichteten Gerät entstand `favorites.json` überhaupt nicht.

In `MainActivity` stand `messung.setzeRahmen(rahmen)` zweiundsiebzig Zeilen
*vor* der Zeile, die das Feld belegt. Weitergereicht wurde also das noch leere
Feld. Marken und Mitschauen, die weiter unten angelegt werden, bekamen den
Rahmen richtig — die Messung als einzige nicht.

Damit fragte sie nur noch das Hauptdokument. Bei AniWorld, s.to und filmo.to
liegt dort nie ein Video: es liegt im Rahmen des Hosters. Kein Messwert, keine
Buchung, kein Weiterschauen — und weil die früheste Rückgabe der Regel keine
Diagnose trägt, stand darüber auch nichts im Protokoll.

Zwei Zeilen, und die zweite ist die wichtigere: der Rahmen wird jetzt angelegt,
bevor ihn jemand bekommt, und `setzeRahmen(null)` beschwert sich. Ein Feld, das
später belegt wird, ist beim Weitergeben trotzdem null; ohne diese Zeile wäre
derselbe Fehler wieder lautlos, und lautlos hat er die ganze Funktion gekostet.

Nachgemessen auf Telefon und Fire TV Stick, die ganze Kette: der
Fünfsekundentakt zählt, der Eintrag steht in `favorites.json`, die Startseite
zeigt „Fortsetzen" mit Stelle und Prozent, ein Neustart ändert nichts, und
„Weiter schauen" setzt an der gebuchten Stelle an statt bei null.

Damit hat auch der Geräteabgleich zum ersten Mal etwas zu melden: gegen ein
echtes Relay geprüft, meldet das Telefon seinen Geräteraum an und legt seinen
Weiterschauen-Stand dort ab — verschlossen, nur mit dem eigenen Schlüssel wieder
aufzumachen.

## 1.48.0 — 26. August 2026

Auf dem Telefon und am Fernseher geht es endlich zur nächsten Folge weiter. Am
Rechner gibt es beides seit Langem: einen Knopf „Nächste Folge“ und den
Schalter, ob es am Ende von selbst weitergeht. Auf Android war weder das eine
noch das andere zu haben — am Fernseher lag die nächste Folge auf der 9 der
Fernbedienung und sonst nirgends, ein Knopf, den niemand sieht.

### Die nächste Folge kommt aus derselben Regel wie am Rechner

Android hatte diese Frage ein zweites Mal beantwortet: ein Textblock in
`MainActivity` zählte die Folgennummer hoch und sprang, wenn die Seite dazu
keinen Link hatte, in die nächste Staffel. Zwei Regeln für dieselbe Frage laufen
auseinander, sobald nur eine gepflegt wird — und diese war die schlechtere: sie
kannte weder das Ende einer Serie noch zusammengefasste Folgen
(„[In E10 enthalten]“). Gefragt wird jetzt `fortschritt.nextEpisodeContinueUrl`
im gemeinsamen Kern, und davor derselbe Torwächter `darfNaechsteFolgeSein`:
dieselbe Serie, weiter vorn als die laufende Folge.

Für den Staffelübergang fehlte der Regel eine Zahl — wo die *laufende* Staffel
aufhört. Am Rechner kommt sie aus der nachgeladenen Staffelübersicht, die es auf
dem Telefon nicht gibt; dort endete deshalb jede Staffel im Nichts. Die
Folgenseite listet ihre eigene Staffel ohnehin: `seitendaten.js` meldet sie
jetzt als `seasonLastEpisode`, aber nur, wenn die laufende Folge in dieser Liste
steht — eine halb geladene Liste hieße sonst, mitten in der Staffel zu springen.

### Drei Abschnitte statt eines Sprungs

Unter neunzig Prozent steht nichts. Ab neunzig Prozent kommt „Nächste Folge ›“
dazu — dieselbe Schwelle wie am Rechner. Am Ende der Folge zählt es von fünf,
mit „Abbrechen“ daneben; ein Abbruch gilt für diese Folge, der Knopf bleibt
danach stehen. Autoplay aus heißt: kein Zähler, aber der Knopf bleibt. Der
Schalter selbst steht unabhängig davon da, solange etwas läuft — eine
Einstellung, die man nur in den letzten zehn Prozent erreicht, ist keine.

Ausgelöst wird am tatsächlichen Ende und nicht bei den neunzig Prozent, ab denen
eine Folge als gesehen zählt. Wer bei 91 Prozent weiterschaut, sieht einen Knopf
und wird nicht aus seiner Folge geworfen.

### Zwei Dinge, die nur auf echter Hardware auffielen

**Die Serienlänge kam nie an.** `Titelbild` hatte genau einen Platz für das, was
eine Seite hergibt, und jede neue Seite hat ihn geleert. Am Rechner fällt das
nicht auf — dort liegt der Hoster in einem Rahmen *innerhalb* der Anbieterseite,
und der Hauptrahmen steht die ganze Wiedergabe über auf der Folge. Auf dem
Telefon nimmt der Hoster den Hauptrahmen, und mit seinem Seitenende war die
Auskunft der Folgenseite weg. Ohne `finalSeason` gibt die Regel nichts zurück:
kein Ziel, kein Knopf, bei 98 Prozent so wenig wie bei 100. Gespeichert wird
jetzt je Adresse, und gelesen wird schon beim Seitenanfang — bei diesen
Anbietern kommt das Seitenende erst mit der letzten Werbung, der Autostart
klickt den Hoster aber nach zwölf Sekunden an. Damit lässt sich eine Serie auf
dem Telefon auch endlich abschließen.

**Und die Leiste verschwand.** Sie hatte den Rückfall des Live-Streifens
übernommen — nach kurzer Ruhe weg, zurück nur auf Berührung. Dessen Auslöser
gibt es beim Alleinschauen aber gar nicht: ob die Bedienelemente des Players
stehen, meldet der Horcher der Watchparty, und der wird ohne eingeschaltete
Watchparty nie eingesetzt. Der Rechner lässt seine Karte verblassen statt
verschwinden; genau das steht jetzt hier.

### Am Fernseher

D-Pad ab führt in die Leiste, auf zurück ins Bild, OK drückt den Knopf statt
aufs Video zu tippen, und der Weg von der Kopfzeile nach unten geht durch die
Leiste statt an ihr vorbei. Die 9 tut weiterhin, was der Knopf tut; die 8 legt
den Schalter um. Zurück bleibt, wie es war.

### Watchparty

Ein Folgenwechsel geht durch dieselbe Kette wie jede andere Navigation und wird
der Runde wie bisher gemeldet — keine zweite Meldung von der Leiste aus. Wer
gerade einem Wechsel der Runde folgt, fängt gar nicht erst an zu zählen; der
Knopf bleibt trotzdem bedienbar.

## 1.47.0 — 26. August 2026

Zwei Sachen in einer Version, und beide fangen an derselben Stelle an: etwas
war gebaut, hiess ueberall gleich und meinte trotzdem nicht dasselbe.

### Android und der Rechner schauen endlich dieselbe Runde

Auf dem Telefon tauchte niemand in der Runde des Rechners auf, eine Pause vom
Handy kam drueben nie an, im Player fehlte die Teilnehmerleiste, und ein Tipp
auf Weiterschauen oeffnete ein Vollbild, in dem nichts lief. Vier Meldungen, im
Kern zwei Missverstaendnisse.

**Der Titelschluessel lief auseinander.** Der Rechner fuehrt einen Titel als
`serie:bleach`, gebildet aus Art und Titel; Android bildete ihn aus der
Serienadresse. Dieselbe Runde, derselbe Anime, zwei Schluessel - und alles, was
daran haengt, fand einander nie: die Mitgliedschaft im Titel, die Standmeldung,
jeder Steuerbefehl, die Hostwahl, die Leiste. Android bildet ihn jetzt nicht
mehr selbst, sondern fragt den Kern, und der benutzt dieselbe Regel wie der
Rechner. Den Rueckweg vom Raumschluessel in die eigene Ablage uebersetzt eine
zweite Auskunft: die Ablage kennt Adressen, der Raum kennt Titel.

**Und die Anwesenheit hing am laufenden Video.** Alles, was das Relay darueber
wusste, kam vom Horcher im Player - und der braucht Medien-Ereignisse eines
`<video>` mit Laufzeit. Bei VOE gibt es die erst nach dem Klick auf die
Ueberlagerung des Hosters. Kein Video, keine Meldung; keine Meldung, keine
Sitzung; keine Sitzung, kein Host; kein Host, keine Antwort auf den Abgleich;
keine Antwort, kein Start - und damit nie ein Video. Ein geschlossener Kreis,
und er stand auf dem Telefon als vier Versuche ohne Antwort und einem stehenden
Bild. Jetzt meldet sich ein Geraet beim Einklinken selbst an, und wer die Runde
fuehrt, wartet nicht auf einen Hostzustand - er ist einer.

### Weiterschauen schaut wirklich weiter

Die Kette endete bisher im Vollbild, und zwar mit Absicht: ein blinder Tipp auf
eine fremde Seite kann auch pausieren. Fuer eine Fernbedienung war das
Zurueckhaltung, fuer einen Tipp auf Weiterschauen war es der gemeldete Fehler -
Vollbild da, Folge steht.

Der Ablauf, der einen VOE-Player wirklich startet, steht seit 1.46.0 im
Folgen-Autostart und hing nur an einer Runde: Ueberlagerung klicken, auf die
Quelle warten, Stelle setzen, starten, nachsehen, ob die Stelle weiterlaeuft.
Er gilt jetzt auch ohne Runde - mit dem gespeicherten Stand statt dem des
Hosts. Das Vollbild kommt erst, wenn der Player gemeldet hat, dass es wirklich
laeuft; startet er nicht, gibt es eine Ansage statt einer schwarzen Flaeche.
Mehrfaches schnelles Tippen auf denselben Eintrag ist ein Tipp.

### Die Teilnehmerleiste im Player

Am Rechner steht waehrend des Schauens oben, wer mitschaut. Auf Android gab es
das nur auf der Watchparty-Seite - also genau dort, wo man beim Schauen nicht
ist. Jetzt liegt der Streifen im Vollbild ueber dem Video: Raum, Host,
Mitschauer, Stand, und aufgeklappt die Aktionen.

Er kommt und geht mit den Bedienelementen des Players, und deren Zustand wird
gemessen und nicht geraten. JW Player, den VOE fuehrt, laesst `.jw-controls`
deckend stehen und blendet `.jw-controlbar` aus - wer den Rahmen misst, meldet
immer "sichtbar" und der Streifen verschwindet nie. Findet sich keine Leiste,
zaehlt die Regung.

### Drei Regeln, die einen Bestand gekostet haben

In der Nacht davor verschwanden 67 Eintraege in derselben Sekunde - Mediathek,
Weiterschauen, Verlauf. Nicht durch einen Absturz: durch Regeln, die einzeln
vertretbar aussahen.

Der Watchparty-Aufraeumer loeschte den *ganzen* Eintrag, sobald ein Favorit
einen Raum trug, dem dieses Geraet gerade nicht beigetreten war. "Ich bin in
dieser Runde nicht mehr dabei" heisst aber nicht, dass es den Titel nie gab -
was jemand gesehen hat, gehoert ihm und nicht dem Raum. Es faellt jetzt nur die
Bindung.

Der Geraeteabgleich uebergeht raumgebundene Titel, weil ihr Stand der Runde
gehoert - und leitete zugleich aus dem, was in seiner Liste *fehlt*, ab, was
hier geloescht wurde. Zurueckgehalten sah damit aus wie weggeworfen, und der
Grabstein ging an alle Geraete. Beides sind jetzt zwei verschiedene Auskuenfte.

Die letzte Staffel einer Serie wurde aus allen `/staffel-N`-Links der Seite
gebildet - auch aus denen fremder Serien in der Randspalte. "Die Legende von
Korra" hat vier Buecher und stand auf sechzehn; danach zaehlte die Regel nach
der letzten Folge brav auf Staffel 5 Folge 1 weiter, die Serie liess sich nie
abschliessen, und in Weiterschauen stand eine Folge, die es nicht gibt. Es
zaehlen jetzt nur die Staffeln der eigenen Serie.

Und "die naechste Folge steht an" faellt erst weg, wenn an ihr wirklich etwas
gelaufen ist. Vorher genuegte das blosse Oeffnen: die Folge hatte keinen
Fortschritt, die vorige war abgehakt, und der Titel war aus Weiterschauen
verschwunden - genau in dem Augenblick, in dem man weiterschauen wollte.

### Geprueft

Am Telefon gegen den Rechner: Weiterschauen startet bei 5:13 und 10:12
wirklich, das Handy erscheint drueben als "Handy (Host) @391s laeuft", Pause in
beide Richtungen, Sprung, Folgenwechsel, App in den Hintergrund und zurueck,
Player verlassen, dreifaches Tippen ergibt einen Start. Dazu 30 Pruefungen an
einem echten Relay, in denen der Titelschluessel nirgends vorgegeben wird -
jede Seite bildet ihn so, wie sie es im Betrieb tut - und 23 Pruefungen, die
festhalten, dass ein Bestand eine Runde ueberlebt, die endet.

Nicht geprueft: Android TV, mangels Geraet.

Bekannt und nicht behoben: Android kann einen Titel weiterhin nicht selbst in
einen Raum einstellen - der Schluessel dafuer stimmt jetzt, der Knopf fehlt.

## 1.46.0 — 25. August 2026

Vier Fehler, drei davon am selben Punkt: gebaut war alles, aber der letzte
Handgriff fehlte. Die Watchparty oeffnete auf Android die richtige Folge und
liess sie dann stehen, und am Fernseher gab es sie ueberhaupt nicht.

### Der Player startet jetzt wirklich

Die Folge ging auf, das Vollbild kam, und dann stand das Bild - mit dem
"Spielen"-Knopf des Hosters mitten drauf. Wer der Runde folgte, musste jedes Mal
selbst tippen, waehrend die anderen weiterschauten.

Gemessen auf dem Telefon (AniWorld -> VOE) liegt es an etwas, das man dem Player
nicht ansieht: der Rahmen des Hosters traegt nach dem Laden ein `<video>` *ohne
Quelle* - `duration=null`, `readyState=0`, `src=""`. Erst der Klick auf seine
eigene Ueberlagerung laedt sie; danach steht `duration=1371` und
`readyState=4`. Autoplay ist auf diesen Geraeten also gar nicht gesperrt - es
fehlte der Klick, und ein `play()` davor lief ins Leere. Dass das nie auffiel,
hatte einen zweiten Grund: das Versprechen von `play()` wurde weggefangen, ein
abgelehnter Start sah damit von aussen aus wie ein gelungener.

Neu ist ein Autostart-*Auftrag*. Er traegt Raum, Titel, Staffel, Folge,
Zieladresse, eine laufende Nummer, die Zeit und den Stand des Hosts - und er
liegt im Kern, nicht in der Ansicht. Das ist der Punkt: eine Navigation raeumt
die Ansicht ab, und genau daran ist die alte Kette gescheitert. Der Ablauf ist
begrenzt und richtet sich nach dem, was die Seite wirklich tut: hoechstens vier
Anlaeufe mit wachsendem Abstand, vor jedem wird der Stand der Runde neu geholt,
das Skript klickt die Ueberlagerung, wartet auf die Quelle, rechnet die Stelle
*danach* neu aus, startet und sieht nach, ob die Stelle auch weiterlaeuft. Erst
dann gilt der Start als gelungen. Klappt es endgueltig nicht, steht es am
Bildschirm statt nur im Protokoll.

Auf dem Telefon war die neue Folge damit nach fuenf Sekunden am Laufen, auf dem
Fernseher nach drei Anlaeufen und fuenfundzwanzig - dieselbe Regel, verschieden
schnelle Geraete, und genau dafuer gibt es die Anlaeufe statt einer festen
Frist.

Wer waehrend des Ladens einsteigt, kommt dort an, wo die Runde inzwischen steht:
Host bei 300 Sekunden und weiterlaufend, Gast steigt bei 333 ein. Steht der Host,
wird nicht hochgerechnet - Host pausiert bei 400, Gast kommt pausiert bei 400 an.
Und wechselt der Host waehrend des Ladens noch einmal, startet nur die neueste
Folge; die uebersprungene kommt gar nicht erst hoch.

### Am Fernseher gibt es die Watchparty jetzt

Die Einstellungen des Fernsehers kannten den ganzen Abschnitt nicht. Unter "Meine
Geraete" stand die Auskunft "die Adresse steht bei der Watchparty" - und verwies
damit auf eine Seite, die es dort nicht gab. Die Serveradresse liess sich weder
eintragen noch aendern, und ohne sie bleibt nicht nur die Watchparty aus, sondern
auch der Geraeteabgleich: beide fahren zum selben Relay. Die Watchparty-Seite
selbst war ebenso unerreichbar, weil sie auf dem Telefon in der unteren Leiste
haengt und die auf dem Fernseher ausgeblendet wird.

Beides steht jetzt da, und zwar aus demselben Code wie auf dem Telefon: ein
Eingabefeld, das wirklich dasteht statt in einem Dialog zu stecken, mit
sichtbarem Fokus, Bildschirmtastatur auf OK und "Fertig" zum Speichern - dazu ein
Knopf in der Kopfzeile. Was eine gueltige Adresse ist, entscheidet ein Modul fuer
alle drei Geraete: Leerzeichen und Schraegstriche am Ende fallen weg, unsichtbare
Zeichen aus einer Fernbedienungstastatur auch, `http`, `https` und ein Port sind
erlaubt, und wer sich vertippt, bekommt es gesagt statt es zu erraten. Eine
falsche Adresse sieht nicht mehr aus wie eine funktionierende: der Status nennt
den Fehler und die Adresse, mit der er auftritt.

### Wer pausiert hat, steht auch richtig da

Das Relay schickt hinter ein Pause sofort die genaue Stelle hinterher. Beide
Anweisungen waren angewendet, bevor der eigene Player sein Pause-Ereignis
meldete - und der Merker, der genau dieses Echo verschlucken soll, trug da schon
die zweite. Also ging das Echo als eigene Tat zurueck an die Runde, und danach
stand in der Leiste "angehalten von" dem Geraet, das die Pause nur befolgt hatte.
Gemerkt wird jetzt in einer Liste statt in einem einzelnen Fach.

Dazu die kleine Schwester desselben Problems: waehrend ein Autostart laeuft, wird
am Player gearbeitet, und was er dabei von sich aus meldet, ist eine Nebenwirkung
und keine Entscheidung. In diesen paar Sekunden geht nichts hinaus - sonst legte
ein Player, der beim Anlauf kurz pausiert, die ganze Runde stumm.

### Geprueft

An drei Geraeten gleichzeitig: dem Rechner-Modul an einem echten Relay, einem
Samsung SM-S928B mit Android 16 und einem Android-TV-Emulator mit API 34.
Folgenwechsel mit Autostart in beide Richtungen, Start bei laufendem und bei
pausiertem Host, zweifacher Wechsel waehrend des Ladens, Play, Pause und Sprung
danach, ein halber bis drei Sekunden Versatz ohne Korrektur und knapp sechs mit,
Hostwechsel, Wiederanschluss, drei Teilnehmer, zwei Titel im selben Raum und der
ganze Weg mit der Fernbedienung durch Einstellungen und Overlay. Dazu 2414
Einzelpruefungen in 65 Suiten samt Typecheck und Lint - darunter eine neue Suite
fuer den Autostart - und 120 JUnit-Faelle.

Nebenbei aufgefallen und mitrepariert: in `package-lock.json` trugen drei fremde
Pakete eine Versionsnummer, die nicht zu ihrem eigenen Paket passte. Eine
Textersetzung bei einem alten Release hatte sie mitgenommen. Aufgefallen ist es
nie, weil installiert wird, was danebensteht.

Nicht belegt: die Desktop-Oberflaeche lief bei diesen Geraetetests nicht mit -
die Rechner-Seite war das echte Modul an einem echten Relay, aber nicht das
Fenster. Und die Hostuebergabe von Hand ist eingebaut und erreichbar, aber nicht
am Geraet ausgeloest worden.

## 1.45.0 — 25. August 2026

Zwei Dinge, die zusammengehoeren und beide dasselbe Muster hatten: gebaut war
alles, nur die Leitung dorthin fehlte. Der Rueckblick zaehlte auf jedem Geraet
fuer sich, und die Watchparty lief auf Android, ohne dass man sie sah oder sie
mitkam.

### Der Rueckblick zaehlt endlich ueber alle Geraete

PC drei Stunden, Handy zwei, Fernseher vier - und jedes Geraet zeigte seine
eigene Zahl. Der Geraeteabgleich war dafuer laengst eingerichtet: `sitzungen.json`
traegt auf beiden Seiten dasselbe Format, `statistik.vereinen` legt zwei Listen
zusammen, und das Relay reicht Sitzungen wie Staende weiter.

Nur reichte Android die Sitzungen genau einmal in die Bruecke - beim Start der
App. Alles, was an dem Abend gemessen wurde, kannte der Abgleich bis zum
naechsten Start nicht. Und was von einem anderen Geraet hereinkam, ging direkt
in die Datei, waehrend das laufende `Statistik` seine alte Liste im Speicher
behielt: ein Rueckblick, den man danach oeffnete, rechnete mit den Zahlen von
vorhin, und beim naechsten Sichern schrieb `Statistik` seinen alten Stand
darueber. Zwei Schreiber auf einer Datei.

Jetzt meldet jedes Sichern der Statistik den neuen Stand, gebuendelt mit
denselben drei Sekunden wie am Rechner. Die Liste kommt aus dem
`Statistik`-Objekt und nicht aus der Datei - dieselbe Ueberlegung wie beim
Bestand: wer daneben die Datei liest, liest im ungluecklichen Augenblick den
Stand von vorhin. Die laufende Sitzung reist als "offen" gekennzeichnet mit und
bleibt beim Abgleich draussen; sie waechst noch, und was von ihr hinausginge,
stuende auf dem anderen Geraet fuer immer als abgeschlossener Satz da. Umgekehrt
reicht die Bruecke nur noch den Zuwachs nach Java statt der ganzen Liste - eine
abgeschlossene Sitzung ist ein Ereignis, und Ereignisse addieren sich, waehrend
bei einer ganzen Liste die Reihenfolge zweier Nachrichten darueber entschied,
ob eine gerade gemessene Sitzung ueberlebt.

Entdoppelt wird ueber die Kennung, an drei Stellen mit derselben Regel: der
Spiegel schickt jede Sitzung genau einmal hinaus, die Bruecke fragt
`statistik.vereinen`, und `Sitzungen.vereinen` in Java tut dasselbe fuer den
Weg hinein. Ueberschrieben wird nie - zwei Geraete koennen denselben Satz nicht
verschieden wissen. Aus 3 + 2 + 4 werden neun Stunden, nicht achtzehn und nicht
drei. Ein offener Rueckblick und ein offenes Wrapped rechnen sofort neu, ohne
Neustart.

### Die Watchparty kommt auf Android wirklich mit

Wechselte die Runde auf Folge 5, oeffnete Android zwar die Seite - aber ohne
Autostart. Der Gast sass vor einer Folgenuebersicht ohne Player, waehrend die
anderen weiterschauten.

Dazu ein zweiter Fehler an derselben Stelle: der Stand der Runde wurde
anderthalb Sekunden nach dem Seitenende angefordert. Auf dem Telefon gibt es
dann noch kein Videoelement - der Hoster wird erst danach angeklickt, und das
dauert Sekunden. Die Antwort traf auf ein Dokument ohne Video, das Skript
meldete "kein-video", und der Gast startete bei 0:00, waehrend die anderen bei
0:12 standen.

Der Folgenwechsel macht den Autostart jetzt scharf, und gefragt wird erst, wenn
sich wirklich ein Rahmen mit Video meldet - einmal je Raum, Titel und Folge, wie
`watchpartyAngeklinkt` am Rechner. Die Zielzeit rechnet danach das Player-Skript
selbst aus, im Augenblick der Anwendung: die Ladezeit steht damit in der
Rechnung. Play bei 12,0 Sekunden und fuenf Sekunden Laden ergeben 17,0. Haelt
der Host waehrenddessen an, wird nicht hochgerechnet und der Gast kommt pausiert
und auf der Stelle des Hosts an. Ohne gemessenen Uhrversatz wird gar nicht
hochgerechnet, und nach oben ist es auf dreissig Sekunden gedeckelt.

Ebenso verlorengegangen war der Watchparty-Kontext beim Hosterwechsel.
`Mitschauen` fragte den WebView nach seiner Adresse; nach "Video oeffnen" steht
dort vidmoly.biz, und damit gehoerte die Seite zu keiner Runde mehr - kein Raum,
kein Schluessel, keine Steuerung. Es zaehlt jetzt dieselbe Folgenadresse wie bei
der Messung.

### Der Live-Streifen ueber dem Bild

Am Rechner steht waehrend des Schauens oben, dass diese Folge live mitlaeuft:
Raum, wer fuehrt, wer angehalten hat, ob die Verbindung steht - und daneben je
Geraet ein Zeichen, ein Name und eine Uhr. Auf Android gab es davon nichts. Der
einzige Ort mit einer Auskunft ueber die Runde war die Watchparty-Seite, also
genau die Seite, auf der man beim Schauen nicht ist.

Jetzt steht dort ein Streifen: zusammengeklappt eine Zeile, auf Tippen oder OK
klappt er Teilnehmer und Aktionen aus und faellt nach kurzer Ruhe von selbst
wieder zusammen. Im Vollbild zieht er in den Vollbild-Rahmen um - deckend, oben,
schmal. Aufgefrischt wird im Sekundentakt, aber ohne Neuaufbau: die Textfelder
bleiben stehen und bekommen neue Texte, und die Teilnehmerzeilen werden nur neu
gebaut, wenn sich die Besetzung wirklich aendert. Auf einem Fernseher ist das
der Unterschied zwischen "der Fokus steht" und "der Fokus faengt jede Sekunde
von vorn an". Mit der Fernbedienung fuehrt D-Pad hoch aus dem Vollbild in den
Streifen, OK klappt auf, Zurueck schliesst die Details und nicht die Folge.

`Livestand.java` rechnet dabei dasselbe wie `renderWatchpartyStand` und
`watchpartyHostText` am Rechner, mit der Frischegrenze aus `Mitschaustand`: wer
eine halbe Minute nichts gemeldet hat, verschwindet, statt fuer immer als
"schaut gerade" dazustehen. Genau daran krankte auch die Karte auf der
Watchparty-Seite - dort stand bisher jedes Mitglied, das je gemeldet hatte, und
die Uhr stimmte eine Sekunde nach dem Empfang schon nicht mehr.

### Abgleichen, weitergeben, privat schauen

Die drei Aktionen des Rechners gab es auf Android nirgends. "Mit Host
abgleichen" laesst alle anhalten, auf die Stelle des Hosts springen und startet
sie gemeinsam - im Streifen und zusaetzlich im Menue jeder Karte, damit man
abgleichen kann, ohne die Folge erst zu oeffnen. Wer bei der falschen Folge
steht, wechselt dabei zuerst dorthin: ein `syncprepare` wird nicht mehr als
"andere Folge" abgewiesen, dieselbe Reihenfolge wie `prepareWatchpartySync` am
Rechner. Der Takt laesst sich weitergeben; das Relay prueft nach, ob der
Empfaenger wirklich bei derselben Folge sitzt.

Und "Live verlassen" beendet ausdruecklich nur die Teilnahme an dieser Folge.
Der Titel bleibt im Raum, die Mitgliedschaft bleibt bestehen, der gemessene
Fortschritt bleibt stehen und zaehlt wieder allein fuer dieses Geraet.
"Live beitreten" holt einen zurueck. Der Merker haengt am Raum, damit man in
einer Runde live sein kann und in der anderen nicht - auch beim selben Anime.

Nebenbei zwei Stellen, die noch auf "es gibt kein Live-Mitschauen auf Android"
standen: die Fortschrittsregel weiss jetzt, wann die Runde die Folge vorgibt,
und Intromarken werden waehrend einer laufenden Runde nicht mehr gelernt - ein
Sprung, den die Runde ausgeloest hat, ist keine Gewohnheit dessen, der hier
sitzt. Und `Watchparty.java` legt `pausedBy` und `lastAction` jetzt nach Titel
und Raum ab statt nur die letzte Meldung: in einem Raum mit drei Serien galt
"Angehalten von Elias" sonst allen dreien.

### Geprueft

2341 Einzelpruefungen in 64 Suiten, dazu Typecheck und Lint. Neu sind zwei
Suiten an einem echt laufenden Relay:

`sitzungentest` 20/20 - drei Geraete nebeneinander, davon zwei echte
Android-Bruecken. Die Zahlen aus der Aufgabe auf die Sekunde: 10800 + 7200 +
14400 = 32400, also neun Stunden, auf allen drei Geraeten. Vier weitere
Abgleiche bringen keine einzige Uebernahme mehr. Die laufende Sitzung bleibt
lokal und geht erst abgeschlossen hinaus, mit ihrer wirklichen Dauer.

`watchpartymatrixtest` 52/52 - zwei Android-Geraete gegeneinander, ohne Rechner
dazwischen, der etwas ausgleichen koennte: Einstieg nach einem Folgenwechsel,
Pause waehrend des Ladens, Drift bei zwei und bei sechseinhalb Sekunden,
Hostwechsel, Wiederanschluss, drei Titel in einem Raum.

Dazu 119 JUnit-Faelle - neu die Zusammenfuehrung der Sitzungen und die
Rechnung des Live-Streifens. `android/jvmprobe/lauf.sh` laesst sie ohne
Android-SDK laufen und uebersetzt dabei beide Bau-Varianten der App vollstaendig
mit; ein Tippfehler in `MainActivity` faellt damit vor dem Release auf und nicht
darin.

Ein Geraet stand wieder nicht zur Verfuegung, und diesmal war auch kein
Android-SDK erreichbar. Der Live-Streifen ist als gezeichnete Ansicht nicht
belegt: nicht auf einem schmalen Display, nicht im Quermodus, nicht im
Vollbild, und der D-Pad-Durchlauf auf einem Fernseher ebenso wenig. Die
Autostart-Kette auf einer echten Anbieterseite ist ausdruecklich "best effort" -
diese Seiten verbrauchen den ersten Klick oft auf ein Popunder. Die
Zielzeit-Rechnung ist am echten Relay gemessen, aber gegen ein nachgebautes
Video und nicht gegen einen Hoster-Player.

## 1.44.0 — 25. August 2026

Die Watchparty auf Android hatte alles ausser einem Weg hinein: man sah, dass
etwas eingestellt war, konnte es aber nicht oeffnen. Dazu die Startseite, die
von einer laufenden Runde nichts zeigte, und Suchtreffer, die als Textzeilen
dastanden.

### Die Watchparty-Seite laesst sich endlich bedienen

Unter jedem Titel im Raum stand genau ein Knopf: "Verlassen". Die Folge liess
sich nicht oeffnen, die Staffel stand nirgends, und wer mitschaut, sah man
nicht. Am Rechner gibt es das alles seit langem - die Daten dafuer schickt das
Relay ohnehin mit, sie wurden nur nicht ausgelesen.

Jede Karte traegt jetzt Poster, Titel, "Staffel 3 · Folge 8 · AniWorld", die
Laufstelle, die Mitglieder und den Host, dazu die Aktionen "Folge oeffnen",
"Beitreten"/"Verlassen" und ein Mehr-Menue mit Hostuebergabe und Rauswurf.
Staffel und Folge stehen nur da, wo die Daten es hergeben; erfunden wird
nichts.

Geoeffnet wird ueber `oeffnungsZiel` in der Bruecke - dieselbe Aufloesung wie
`openWatchpartyItem` am Rechner: Anbieter aus `geraete-stand.anbieterFinden`,
Zieladresse aus dem Fortschritt der Runde statt aus der Serienadresse. Damit
landet man auf `.../bleach/staffel-3/episode-8` und nicht auf der Uebersicht.
Ohne aufloesbaren Anbieter bleibt der Knopf abgeschaltet, statt ins Leere zu
fuehren.

Ein Raum darf mehrere Titel fuehren. Jede Karte reicht ihren eigenen
Schluessel *und* ihren Raum durch, es gibt keinen "aktuellen Eintrag", der sich
ueberschreiben liesse - ein Klick auf Bleach oeffnet nie BLACK TORCH. Steht
derselbe Titel in zwei Raeumen, bleiben es zwei Karten mit zwei Staenden.
"Verlassen" betrifft wie am Rechner nur den einen Titel; der Raum selbst wird
allein in den Einstellungen entfernt.

Wer aus der Watchparty eine Folge oeffnet, kommt mit Zurueck auch wieder
dorthin und nicht auf die Startseite. Auf dem Fernseher sind alle drei
Aktionen je Karte eigene Fokusziele in der Reihenfolge der Karten.

Die Sync-Engine selbst ist unberuehrt: Driftgrenze, Hostwahl, Relay-Protokoll,
Wiederanschluss, Uhrenabgleich und Schleifenschutz stehen unveraendert in
`watchparty-sync.js`.

### Gemeinsam weiterschauen auf der Startseite

Die Reihe gab es, aber ihre Kacheln waren die einer Serie, die man allein
schaut: ein Balken vom letzten eigenen Messwert und sonst nichts. Man sah der
Startseite nicht an, dass ueberhaupt jemand mitschaut.

Jede Kachel in "Weiterschauen" zeigt jetzt die Stelle im Klartext
("12:04 / 24:10"). Eine Kachel aus einer Runde traegt zusaetzlich ihren Raum
unter dem Titel und darunter, wer gerade schaut - "Anna schaut gerade", "Anna
pausiert" -, und ihr Balken folgt der Stelle des Fuehrenden statt der eigenen
von vorhin. Ohne Standmeldung gilt fuenfundzwanzig Sekunden lang, wer zuletzt
einen Fortschritt geteilt hat.

Nachgezogen wird im Sekundentakt in Ort - nur Text und Balkenbreite, keine neue
Seite. Am Telefon spraenge sie sonst beim Blaettern, auf dem Fernseher
verschwaende jede Sekunde die Ansicht, die den Fokus haelt. Dieselbe
Ueberlegung wie `aktualisiereLiveKarten` am Rechner.

`Mitschaustand.java` rechnet dabei woertlich dasselbe wie `renderer.js`:
Frische von zwanzig Sekunden, der Host fuehrt, Position plus Alter plus Zeit
seit dem Empfang - bei einem Pausierten laeuft nichts weiter. Nicht ueber den
Kern, weil eine Bildlaufliste beim Zeichnen nicht auf eine Antwort warten kann;
die Prueffaelle daneben halten beide Fassungen zusammen.

`Watchparty.java` legt Standmeldungen jetzt nach Titel und Raum ab statt nur
die letzte. In einem Raum mit Bleach, BLACK TORCH und Korra zeigten sonst alle
drei Kacheln den Stand dessen, der zufaellig zuletzt gemeldet hat. Beim
Eintreffen wird markiert, welches Mitglied dieses Geraet ist - ohne das stuende
auf der eigenen Startseite "Wohnzimmer schaut gerade", waehrend man selbst das
Wohnzimmer ist.

### pausedBy und lastAction kamen nie an

`watchparty.js` warf beim Empfang einer Standmeldung zwei Felder weg. Das Relay
schickt sie, `main.js` und die Android-Oberflaeche lesen sie - angekommen sind
sie nie. Deshalb blieb "Angehalten von ..." auf beiden Geraeten leer. Wer
gedrueckt hat, ist etwas anderes als wer gerade stillsteht: zieht ein zweites
Geraet die Pause nur mit, bleibt der Ausloeser derselbe.

### Suchtreffer mit Bild

Die Suche geht ueber alle Anbieter gleichzeitig und zeigte ihre Treffer als
Textzeilen mit zwei Buchstaben als Platzhalter. Das Bild steht aber im selben
Verweis, den die Suche ohnehin ausliest.

`Trefferbild.java` holt es dort heraus: Bildmarke, Auswahlliste (die groesste
Fassung), verzoegerte Adressen wie `data-src` - denn wo eine steht, ist `src`
meist nur das durchsichtige Pixel -, sonst das Hintergrundbild. Nichts wird
nachgeschlagen und nichts aus dem Namen geraten. Logos, Sprachabzeichen,
Sprites, SVG-Symbole und Platzhalter zaehlen nicht: ein falsches Bild ist
schlechter als keins, und ohne Bild bleibt der gestaltete Platzhalter.

Anbieter mit reiner JSON-Schnellsuche liefern kein Bild mit. Fuer sie wird
einmal je Suche die gewoehnliche Trefferseite geholt und ueber die Adresse
zugeordnet - nicht je Treffer, und gar nicht, wenn schon alle Treffer ein Bild
haben.

### Geprueft

Gegen ein echt laufendes Relay mit der echten Android-Bruecke: `mitschauentest`
49/49, darunter drei Titel in einem Raum, derselbe Titel in zwei Raeumen und
die Standmeldung mit Kennung, Alter, Host, `pausedBy` und `lastAction`. Dazu 88
JUnit-Faelle - neu die Kachelrechnung und die Bildauslese - und die volle
JS-Suite, Typecheck und Lint.

Ein Android-TV-Emulator stand erneut nicht zur Verfuegung: kein Geraetetest,
kein Logcat, keine Screenshots. Die echte WebView-Navigation, das Bildladen der
Anbieter und der D-Pad-Durchlauf auf einem Fernseher sind damit nicht belegt.

## 1.43.0 — 25. August 2026

Zwei Dinge, die es auf dem Fernseher gar nicht gab: eine Startseite, die dem
Rechner entspricht, und eine Watchparty, die wirklich mitschaut. Dazu die
Werbung, die auf dem Foto oben rechts stand.

### Werbung auf den Anbieterseiten

Die beiden Karten auf AniWorld - "Wir sind fuer dich da" und "The file is ready
to download" - kamen durch drei Luecken zugleich. `isPageCriticalRequest` laesst
Bilder, Stilblaetter und Schriften ungeprueft durch, damit keine Seite am Filter
zerbricht; genau daraus bestehen diese Karten. Der `Werbefilter` mit den vollen
AdGuard-Regeln laeuft laut `geraetTraegt` erst ab drei Gigabyte und damit auf
keinem Fernseh-Stick. Und die `Kosmetik` fragt nur, was den Player zudeckt, und
fragt es erst nach dem Seitenende - eine Karte in der Ecke faellt gar nicht in
ihre Frage, und selbst wenn, haette sie vorher aufgeblitzt.

`Fernsehwerbung.java` schliesst alle drei. Ein Stilblatt geht ueber
`addDocumentStartJavaScript` in jedes Dokument, bevor dessen eigene Skripte
laufen - was benannt ist, ist nie sichtbar. Was nicht benannt ist, entscheidet
eine Punktevergabe mit der Schwelle vier, und keine einzelne Beobachtung gibt
vier: "Banner", "Popup" oder "Overlay" allein reichen konstruktiv nie. Ein
begrenzter MutationObserver holt das Nachgereichte, mit hartem Deckel bei 4000
geprueften Elementen je Dokument.

Geschuetzt sind Video, Formular, Anmeldung, Captcha und jeder Rahmen mit
unbekanntem fremdem Wirt - dort laeuft der Player, und die Hoster liefern ihn
von wechselnden Wegwerf-Adressen. Iframes werden nie pauschal entfernt.
Nirgends steht eine Bildschirmstelle: eine unsichtbare Klickflaeche wird daran
erkannt, dass sie durchsichtig und inhaltsleer ist, nicht daran, wo sie liegt.
Das Skript geht ausdruecklich nicht in den Rahmen des Hosters - VOE zaehlt mit,
was auf seiner Seite fehlt.

Auf der Anfrageseite prueft `istKernWerbeAnfrage` die kuratierten Kernlisten
jetzt *vor* der Ausnahme fuer Seitenbestandteile. Nur auf dem Fernseher, und
nicht im Hosterrahmen.

### Die Sperrmeldungen sind weg

"Popup blockiert", "Weiterleitung blockiert", "Externer Link blockiert" und
"Provider-Wechsel blockiert" - alle vier. Sie waren als Erklaerung gedacht und
kamen als Stoerung an: eine Werbekette versucht es in Schueben, und auf einem
Fernseher stand die Meldung quer ueber dem laufenden Bild. Gesperrt wird
unveraendert weiter; was geschehen ist, steht im Debug-Bau in der Spur.

### Die Startseite des Fernsehers

Sie zeigte drei Reihen zu je fuenf Kacheln. Jetzt zeigt sie, was der Rechner
zeigt: Titelhintergrund mit Bild, Folge, Fortschritt und zwei Aktionen, Wechsel
durch die zuletzt angefangenen Titel, Weiterschauen, Watchlist, Mediathek, Neue
Folgen, "Neu bei deinen Anbietern", "Empfohlen fuer dich", Anime, Serien und
Filme je einzeln mit ihren ausformulierten Gruenden, "Mehr anzeigen" und die
Entdeckungsseiten mit Nachladen. Gerechnet wird nichts davon dort: es sind
dieselben Klassen wie auf Telefon und Rechner.

Bedient wird sie mit der Fernbedienung: jedes Ziel traegt seinen Fokuszustand,
jede Reihe legt nach, bevor der Fokus ihr Ende erreicht, und der Platz wird je
Seite gemerkt. Der Titelhintergrund haelt an, sobald jemand in ihm navigiert.
In der Anbieteransicht erreicht das Steuerkreuz jetzt auch Sprachwahl und
Hosterliste - auf AniWorld sind das `<img>`- und `<li>`-Elemente, die keine
Auswahl nach Links und Knoepfen findet.

### Die Watchparty schaut auf Android wirklich mit

Bis hierher war sie auf Telefon und Fernseher ein Fortschrittsabgleich:
derselbe Raumcode, derselbe Weiterschauen-Stand - aber wer Pause drueckte,
drueckte allein. Gefehlt hat dabei keine Fachlogik. Verbindung,
Wiederanschluss, Uhrenabgleich, Raeume, Zielzeit und Driftgrenze standen von
Anfang an in den geteilten Modulen; wer Host ist, entscheidet ohnehin das
Relay. Gefehlt hat die Verkabelung zum Video im WebView - und ein Stueck, das
nur der Rechner hatte.

Dieses Stueck ist der Horcher am Player. Er stand in `main.js` und ist jetzt
`watchparty-sync.beobachterScript()`: woertlich dasselbe Skript auf beiden
Geraeten. Dazu kommt `steuerungEntscheiden()` - was mit einem eingehenden
Befehl zu geschehen hat, entschied bisher `main.js` allein. Beide Seiten fragen
jetzt dieselbe Funktion; `main.js` ist um ihre Kopie leichter geworden.

`Mitschauen.java` entscheidet nichts: was zu tun ist, fragt es ueber die
Bruecke im Kern, und was es in den Player einsetzt, ist das Skript, das der
Rechner dort einsetzt. Play, Pause, Sprung, Folgenwechsel und
Beitrittsabgleich laufen damit in beide Richtungen.

Dass es einen Folgenwechsel ueberlebt, haengt an drei Dingen: der Horcher
haengt am Dokument in der Abfangphase und nicht an einem Videoelement, er wird
bei jeder Rahmenmeldung nachgereicht - also auch nach Hoster- und
Sprachwechsel, nicht nur am Seitenende -, und der Zustand der alten Folge wird
verworfen, sonst wiese die Veraltungspruefung die ersten Befehle der neuen
Folge als Nachzuegler ab.

Keine Schleife: `applyScript` meldet vor jeder Anwendung an, was der eigene
Player gleich zurueckmelden wird, und der Horcher verschluckt genau dieses eine
Echo. Wer waehrend eines eingehenden Play selbst Pause drueckt, kommt weiterhin
durch. Kein Zeitgeber.

Kein Host, der keiner mehr ist: beim Verlassen der Anbieterseite und beim
Wechsel in den Hintergrund meldet sich das Geraet sofort ab. Im Hintergrund
geht ausserdem keine Tat mehr hinaus - ein von Android angehaltener Player ist
keine Entscheidung des Zuschauers.

Die Medientasten der Fernbedienung gehen jetzt in den Rahmen des Hosters.
Vorher liefen sie ueber `evaluateJavascript` und erreichten nur das
Hauptdokument - bei AniWorld und s.to liegt das Video woanders, und die Taste
tat schlicht nichts. Play und Pause sind getrennt statt Umschalter.

### Der 502 im Playerkasten

Ein Serverfehler im Rahmen blieb als fremde Fehlerseite stehen, weil
`onReceivedError` nur den Hauptrahmen sieht und `onReceivedHttpError` gar nicht
ueberschrieben war. Jetzt wird der Rahmen einmal nachgeladen und beim zweiten
Mal durch einen eigenen Satz ersetzt - nur der Rahmen; Folgenliste, Sprachwahl
und Hosterliste bleiben unberuehrt.

### Geprueft

Die neue Suite `mitschauentest` faehrt die echte Android-Bruecke gegen ein
echtes Relay: Play, Pause, Sprung in beide Richtungen, Folgenwechsel von beiden
Seiten, Hoster- und Sprachwechsel, Hostwechsel beim Verlassen, Beitrittsabgleich,
Reconnect und zehn Tastendruecke, die zehn Ereignisse ergeben (31/31).
`playertest` prueft den Horcher gegen ein nachgebautes Video samt Loop-Schutz
und Austausch des Videoelements (32/32). Dazu 43 JUnit-Faelle fuer die
Regellisten der Werbeentfernung und die Folgenerkennung.

**Nicht geprueft:** Es stand kein Android-TV-Emulator zur Verfuegung. Kein
Gerätetest, kein Logcat, keine Screenshots.

## 1.42.0 — 25. August 2026

Die vier letzten Unterschiede zur Startseite des Rechners sind weg: Kalender,
Jahresrueckblick, YouTube-Reihe und die Schalter fuer sichtbare Reihen. Auf dem
Weg dorthin kam wieder ein Fehler ans Licht, der schwerer wiegt als das Feature.

### Eine Serie konnte auf Android nie abgeschlossen werden

Nicht selten - nie. `seitendaten.js` liest laengst die Grenzen einer Serie:
welche Staffel die letzte ist und welche Folge darin. `Titelbild` griff daraus
nur das Bild und das Favicon heraus und warf den Rest weg. Damit erreichten
`finalSeason` und `finalEpisode` die geteilte Regel nie. Die letzte Folge wurde
abgehakt wie jede andere, der Eintrag blieb in "Weiterschauen" stehen und
wartete auf eine Folge, die es nicht gibt - die Mediathek konnte auf diesem Weg
gar nicht gefuellt werden.

Die Auskunft der Seite laeuft jetzt durch `fortschritt.gepruefteSeitendaten` -
dieselbe Pruefung, die der Rechner benutzt, und sie wirft weg, was zu einer
anderen Adresse gehoert. Uebernommen werden Titel, Art, Staffelgrenzen und
nicht spielbare Folgen. Mit denselben Messwerten in Node: ohne Grenzen
`completed=false`, mit ihnen `completed=true`.

### Der Kalender

Die Runde um die beiden Parser stand in `main.js` und war damit an Electron
gebunden - welche Adressen probiert werden, in welcher Reihenfolge, wie lange
eine Antwort gilt und auf welche Woche gekuerzt wird. Sie steht jetzt in
`src/kalender.js`; `discover.js` mit den Parsern war ohnehin schon geteilt.
`main.js` wird dabei um 144 Zeilen leichter.

Auf dem Telefon steht der Kalender als Reihe "Diese Woche" auf der Startseite,
mit einer eigenen Ansicht dahinter: ein Reiter je Wochentag mit Eintragszahl,
darunter die Folgen mit Fassung und Anbieter. Gemessen auf dem Emulator: 139
Eintraege von S.to ueber `api/calendar`, 92 von AniWorld ueber `animekalender`,
nach dem Wochenfilter 134.

### Rueckblick und Jahresrueckblick

Hier fehlte nicht die Ansicht, sondern die Datenbasis: **die Android-App hat nie
eine Sekunde Wiedergabezeit aufgezeichnet.** Der Schritt von der Messung zur
Sitzung stand in `main.js`. `statistik.js` lag zwar laengst im Kern, bekam dort
aber nie eine Meldung; ein Rueckblick haette zwangslaeufig eine leere Bilanz
gezeigt - schlimmer als keiner, weil eine Null wie eine Aussage aussieht.

Der Schritt liegt jetzt in `src/sitzungslauf.js` und wird von beiden Geraeten
gefahren, die Ablage in `Statistik.java` mit `sitzungen.json` im Format des
Rechners. Geschrieben wird alle 30 Sekunden und beim Pausieren - auf einem
Telefon wird eine App nicht beendet, sie verschwindet.

Darauf sitzen zwei Ansichten. Der Rueckblick mit Zeitraeumen, Kennzahlen und
Ranglisten; der Jahresrueckblick als Kartenfolge mit derselben Abfolge wie am
Rechner - Auftakt, Watchtime, Folgen, Abschluesse je Gattung, Serie und Film des
Jahres, Genre, Mix, Strecke, Wochentag, Rekordtag, laengste Sitzung,
Tageszeit-Typ, Wiederholungen, Monat, erster und letzter Titel, Fakten, Finale.
Jede Karte faellt weg, wenn ihre Zahl nicht belegt ist, und der Zeitraum steht
ausdruecklich dabei: was vor der Messung liegt, wird nicht behauptet.

### YouTube bekommt seine eigene Reihe

Mit der Begruendung des Rechners: ein angefangenes Video und eine angefangene
Serie sind zwei verschiedene Dinge. Gemischt schiebt das eine das andere aus der
Reihe, und weil YouTube-Videos oft kommen und gehen, waeren es meist die Serien,
die verdraengt werden. Die Namensliste kommt aus `youtube.js` im Kern; nur der
dreizeilige Abgleich laeuft in Java, damit nicht je Eintrag und Zeichenlauf ein
Aufruf in den Kern geht.

### Sichtbare Startseitenreihen

Sieben Schalter unter "Startseite" in den Einstellungen. Die Schluessel sind
absichtlich dieselben wie am Rechner (`showHero`, `showFavorites`,
`showYoutube`, `showPersonal`, `showCategories`, `showReview`), damit sie
spaeter ueber denselben Geraeteabgleich wandern koennen; `showCalendar` kommt
dazu, weil der Kalender hier eine Reihe ist und keine Seite in der Seitenleiste.
Sind alle Reihen aus, steht der Weg zurueck auf der Startseite selbst - dort, wo
der Mangel auffaellt, und nicht in einer Einstellung, die man erst suchen muss.

### Ohne Netz verschwindet nichts mehr wortlos

Der Empfehlungslauf faengt einen gescheiterten Abruf ab und gibt eine leere
Liste zurueck. Das ist richtig - ein Ausfall bei einem Anbieter soll nicht die
ganze Reihe zum Fehler machen. Die Oberflaeche las "leer und fertig geholt" als
"dazu gibt es nichts" und liess die Reihe ganz weg; auf einem Telefon ohne
Empfang verschwand damit die halbe Startseite kommentarlos.

Jetzt unterscheidet `Netz.vorhanden()` die beiden Faelle. Dazu ein
Zwischenspeicher, der die fuenf Vorschlagsreihen und die Kalenderwoche als
Ergebnis auf die Platte legt und beim Start *vor* dem Lauf einliest: ein Start
ohne Netz zeigt den letzten bekannten Stand samt seinem Alter ("Ohne Netz -
Stand vor 2 Minuten") und einen Knopf. Ist gar nichts da, steht ein erklaerter
Offline-Zustand mit "Erneut versuchen" - einmal fuer alle Vorschlagsreihen, und
die oertlichen Bereiche bleiben unangetastet.

Ein alter Stand bekommt eine kuerzere Frist als ein frischer (eine Minute statt
einer Viertelstunde), damit die Rueckkehr des Netzes schnell auffaellt. Und
"Ohne Netz" steht nur da, wenn wirklich keine Leitung da ist; sonst heisst es
"Gerade nicht erreichbar" - eine Zeile behauptet nichts ueber einen Zustand, den
sie nicht kennt.

### Der Pruefstand

Die Fortschrittsregel haengt an Schwellen, die in echter Zeit gemessen werden:
2:30 Wiedergabe, 90 Prozent, 60 Sekunden fuer den Rueckweg. `messung.js`
deckelt den Zuwachs bewusst auf die wirklich verstrichene Zeit - ein schnell
durchgezogenes Video zaehlt nicht. Eine Pruefung aller Faelle dauerte damit
Stunden.

Abgekuerzt wird deshalb nicht die Regel, sondern das Video. Der Pruefstand
liefert genau das, was das Messskript aus der Seite gelesen haette, und
uebergibt es `Messung.verbuchen`; ab dieser Zeile ist alles unveraendert die
Strecke einer echten Wiedergabe. Er liegt in `app/src/debug/java` - der
Release-Bau uebersetzt einen leeren Rumpf ohne Empfaenger, ohne Aktion und ohne
einen einzigen Zugriff auf die Ablage. Es fehlt dort also nicht der Schalter,
sondern der Code.

### Kleinigkeiten

- Beim Verlassen einer Anbieterseite wird die offene Sitzung geschlossen; ohne
  das bliebe die letzte Folge eines Abends ungezaehlt.
- Ein vorgeladener Stand loeste beim Einbau eine Abrufschleife aus - sechs
  Abrufe derselben Reihe in drei Sekunden. Jetzt entscheidet der Zeitpunkt und
  nicht die Herkunft, und er wird auch dann gesetzt, wenn nichts hereinkam.
- Der Pruefstand haengt sich an die App, die ihn eingerichtet hat. Beim
  Neuaufbau leben zwei Ansichten kurz nebeneinander, und das `onDestroy` der
  alten meldete den Empfaenger der neuen ab.

### Geprueft

Neu: 33 Unit-Pruefungen und 17 Pruefungen auf dem Geraet
(`FortschrittGeraeteTest`, `StartseiteGeraeteTest`), dazu drei Faelle mehr im
`rueckblicktest` (78/78). Alle Suiten des Rechners bestanden, Lint und Typecheck
sauber, `assembleDebug` und `lintDebug` erfolgreich.

Gefahren auf einem eigens angelegten Emulator (AVD `elfix_pruef_api35`, Pixel 6,
Android 15 / API 35, 1080x2400 bei 420 dpi): alle elf Wiedergabefaelle - vor
2:30, ueber 2:30, 75 Prozent, Folgenwechsel, Sprung nach vorn, letzte
Serienfolge, Film, Watchlist zu Mediathek, App-Neustart, Prozessabbruch und die
Frage nach Doppelten. Dieselbe Abfolge wurde anschliessend Schritt fuer Schritt
durch `fortschritt.medienStandVerbuchen` in Node nachgefahren; jeder Wert stimmt
ueberein.

Dazu Hoch- und Querformat, 720x1280 und 1440x3120, Prozessneustart nach
Rotation, Offline-Start mit und ohne Cache, langsames Netz (EDGE mit
UMTS-Verzoegerung), fehlende Bilder, schnelles Scrollen, mehrfaches Antippen,
Watchlist und Weiterschauen, Zuruecknavigation, Hintergrund und Fortsetzen. Der
Speicher steigt beim Scrollen nicht (233 MB vor, 161 MB nach vierzig Wischen),
und nach dem Start steht je Reihe genau ein Abruf - auch nach zwanzig
Bildschirmwechseln.

Nicht uebernommen und einzeln begruendet: die Kalenderfilter nach Art und
Fassung, die Genre-Aufteilung im Rueckblick (sie kommt aus dem Geschmacks-Cache
des Empfehlungslaufs), `providerCardMeta`, `librarySort` und das
Erscheinungsbild des Rechners.

## 1.41.0 — 25. August 2026

Die Startseite des Telefons zeigt jetzt dasselbe wie die des Rechners. Auf dem
Weg dorthin kamen zwei Fehler ans Licht, die schwerer wiegen als das Feature:
Android hat nie einen Wiedergabefortschritt gespeichert, und der Herz-Knopf tat
in den meisten Faellen gar nichts.

### Android hat nie Fortschritt verbucht

Nicht selten, nicht gelegentlich — nie. "Weiterschauen" konnte damit gar nicht
funktionieren, und was dort trotzdem stand, kam vom Geraeteabgleich.

Die Ursache liegt im Unterschied der beiden Apps. Am Rechner liegt der Hoster in
einem eingebetteten Rahmen, und die Adresse der Anbieterseite bleibt in der
Ansicht stehen. Auf dem Telefon ersetzt "Video oeffnen" bei AniWorld das
*oberste* Dokument: danach steht dort vidmoly.biz. Gemeldet wurde genau diese
Adresse, und die Fortschrittsregel verwarf sie zu Recht — sie erkennt darin
keine Folge.

Lautlos war es, weil ausgerechnet dieser frueheste Ausstieg der Regel als
einziger keine Diagnose traegt. Im Protokoll stand also die gemessene Sekunde
und danach nichts.

Jetzt zaehlt die zuletzt besuchte Folgenseite, sobald die laufende Adresse dem
Anbieter nicht mehr gehoert. Nur dann — wer beim Anbieter selbst weiterblaettert,
meldet weiter seinen wirklichen Ort. Nachgemessen auf einem S24 Ultra: vor 150
Sekunden Wiedergabe bleibt der Stand bei null, die 2:30-Schwelle haelt; danach
steht er in der Ablage.

Dazu protokolliert Android jetzt, *warum* die Regel einen Stand nicht uebernimmt
— einmal je Art, nicht zwoelfmal in der Minute.

### Der Herz-Knopf tat meistens nichts

Er taeuschte der Fortschrittsregel einen Mindeststand vor, damit sie ueberhaupt
einen Eintrag anlegt. Das hatte zwei Folgen, und beide waren falsch: bei einer
Serienuebersicht und bei jeder Folge ausser der ersten legte sie nichts an — ohne
2:30 Wiedergabe und ohne Folge 1 blockiert sie —, und wo sie anlegte, trug der
Eintrag zehn Prozent Fortschritt und stand damit sofort auch in
"Weiterschauen". Vorgemerkt und angefangen sind aber zwei verschiedene Dinge.

Vormerken hat jetzt eine eigene Regel im geteilten Modul. Der Rechner benutzt
dieselbe, wenn ein Suchtreffer auf die Watchlist wandert.

### Der Empfehlungslauf steht jetzt einmal

Geschmacksprofil, Kandidatensuche, Katalogtiefe, Entdeckungsseiten und die
Anreicherung mit externen Metadaten lagen in main.js und waren dadurch an
Electron gebunden — an drei Dinge: einen Seitenabruf, eine Datei und ein
Fenster. Android konnte damit nichts anfangen und hatte deshalb ueberhaupt keine
Empfehlungen.

Sie stehen jetzt in src/empfehlungslauf.js, bekommen diese drei Dinge gereicht
und laufen unveraendert im Kern der Android-App. Damit rechnen beide Geraete
dieselbe Rangfolge mit denselben Schwellen und denselben Begruendungen.

Das Telefon rechnet mit kleineren Zahlen — Pool 1200 statt 4000 —, weil der
Kern-WebView daneben schon den Werbefilter traegt. Es ist dieselbe Liste, sie
endet nur frueher.

### Die Startseite des Telefons

Titelhintergrund mit dem Bild des Titels, der Folge, dem echten Stand
("3:18 / 22:51"), einem Fortschrittsbalken und zwei Knoepfen; er wechselt alle
fuenfzehn Sekunden durch die fuenf zuletzt geschauten Titel, und die Punkte
darunter sind auch Bedienung.

Darunter waagerechte Reihen statt einer senkrechten Liste: Neue Folgen,
Weiterschauen, Gemeinsam weiterschauen, Watchlist, Mediathek, Neu bei deinen
Anbietern, Empfohlen fuer dich, Anime, Serien und Filme fuer dich. Jede
Vorschlagskarte traegt den Satz, warum sie dasteht — "Passend zu Naruto auf
deiner Watchlist", nicht "empfohlen".

"Mehr anzeigen" oeffnet je Art eine eigene Seite, die beim Scrollen weiterlaedt
und ihre Stelle behaelt, wenn man einen Titel oeffnet und zurueckkommt.

Hochkant statt quer, weil eine liegende 16:9-Flaeche auf einem schmalen
Bildschirm entweder zwei Zentimeter hoch waere oder das Bild bis zur
Unkenntlichkeit beschneidet. Die Reihen laufen ueber den Seitenrand hinaus,
damit die letzte sichtbare Kachel andeutet, dass es weitergeht. Beim Drehen
werden die Masse neu gerechnet — vorher blieben es die des Hochformats —, ohne
dass dabei irgendetwas neu geholt wird.

### Und die Bilder bleiben bezahlbar

Ein Raster, das beim Scrollen unbegrenzt waechst, haelt jedes gesetzte Bild an
seiner Ansicht fest, auch wenn die Karte laengst hundert Zeilen weiter oben
steht. Bei dreihundert Karten sind das mehrere hundert Megabyte, und die App
verschwindet lautlos. Geladen wird jetzt, was in der Naehe des Bildschirms ist,
und wieder freigegeben, was es nicht mehr ist; zurueck bleibt der gestaltete
Platzhalter.

### Kleinigkeiten

- "Weiterschauen" sortiert auf dem Telefon jetzt nach derselben Staffelung wie
  am Rechner. Vorher zaehlte nur "zuletzt geschaut", und ein Eintrag ohne diesen
  Zeitstempel fiel ans Ende, obwohl er der zuletzt angefasste war.
- Auf keiner Kachel von "Neu bei deinen Anbietern" stand je ein
  Erscheinungsdatum — auch am Rechner nicht: in die Extraktion ging das ganze
  Abrufergebnis statt seines Quelltextes, und daraus wurde "[object Object]".
- Der Fortschrittsbalken zeigt Stand durch Laufzeit, nicht das abgelegte Feld.
  Das ist dieselbe Rechnung wie am Rechner und aktueller als der Merker, der an
  bestimmten Stellen absichtlich gesetzt wird.

## 1.40.1 — 24. August 2026

Zwei Sperren, die zu spaet kamen - und deshalb selbst das waren, was sie
verhindern sollten.

### AniWorld wurde weiss, nachdem die Werbung blockiert war

Gemeldet war: auf AniWorld erschien "Weiterleitung blockiert", und danach war
die Ansicht weiss oder blieb dauerhaft bei "wird geladen ...". Die naheliegende
Lesart - der Blocker sperrt zu viel - war die falsche. Er sperrte zu spaet.

Ein Klick auf einen Hoster gab der Seite vier Spruenge Budget, damit die Kette
des Hosters aufgehen kann. Verbraucht wurde dieses Budget aber, *bevor*
irgendjemand nach dem Ziel gefragt hatte. Die Werbeskripte einer Episodenseite
feuern genau in diesem Augenblick; sie nahmen die vier Spruenge, und gesperrt
wurde erst der fuenfte. Da war die Folgenseite drei Navigationen her, und
stehen blieb, was zuletzt bestaetigt worden war: eine leere Werbe-Weiche.

Genau in dieser Reihenfolge sah es der Benutzer - erst die Meldung, dann weiss.
Die Meldung war nie zu frueh, sie war zu spaet.

Das Budget bleibt, denn ohne es geht der Hoster nicht auf: dessen zweiter
Sprung kommt vom Skript und nicht vom Server. Es greift jetzt aber nur noch
dort, wo wirklich eine solche Kette laufen kann - bei einer Weiterleitung des
Servers, oder bei einem Sprung aus einem Dokument, das dem Anbieter schon nicht
mehr gehoert. Der Werbesprung ist keines von beidem: er kommt aus dem Skript
und geht von einer Seite des Anbieters aus. Er wird gesperrt, waehrend die
Folgenseite noch dasteht - und damit bleibt sie stehen.

### Und die Ladeschicht ging nie wieder weg

Der zweite Teil derselben Meldung, aber eine eigene Ursache: die Schicht
"AniWorld wird geladen ..." wird abgeraeumt, wenn eine Seite fertig laedt. Eine
abgebrochene Navigation laedt nie fertig. Also blieb sie stehen, bis jemand den
Anbieter wechselte.

### Der Autoplay-Schalter klebte ueber der Serienuebersicht

Er entschied nach der Form der Seite - "oberstes Dokument, kein grosser Rahmen"
-, und das trifft auf jede Hosterseite zu, aber eben auch auf eine Startseite
ohne jedes Video. Jetzt entscheidet, ob dort etwas laeuft: Folge, Film,
YouTube-Video ja; Startseite, Suche, Uebersicht und Shorts nein. Und er
verschwindet wieder, wenn man vom Video zurueckgeht - YouTube wechselt die
Seite, ohne das Dokument neu zu laden.

## 1.40.0 — 24. August 2026

Drei Fehler, die sich beim Nachmessen als drei ganz verschiedene Dinge
herausgestellt haben - und zweimal war die naheliegende Erklaerung die falsche.

### Aus Attack on Titan wurde eine fremde Serie

Gemeldet war: nach dem Wechsel zur naechsten Folge standen Titel, Beschreibung
und Genres von "Young Ladies Don't Play Fighting Games" auf der Karte, waehrend
das Bild noch Attack on Titan zeigte. In den Daten sah das so aus:

    url:          .../attack-on-titan/staffel-3/episode-20
    thumbnail:    .../attack-on-titan-stream-cover-...
    title:        "Young Ladies Don't Play Fighting Games"
    finalSeason:  1     (Attack on Titan hat vier)

- **Der Autostart hat eine Empfehlungskachel angeklickt.** Er sucht auf der
  Seite einen Play-Knopf und wertet dafuer das Wort "play" - im Text wie in der
  Klasse. In "Young Ladies Don't **Play** Fighting Games" steht es. Die Kachel
  liegt auf AniWorld in jeder Empfehlungsspalte, und deshalb war es immer
  dieselbe fremde Serie. Im Protokoll:
  `startknopf-geklickt:Young Ladies Don't Play Fighti`
- Ein Play-Knopf fuehrt jetzt nicht mehr von der Seite weg - er startet, was
  schon da liegt -, und "play" zaehlt nur als Aufschrift eines Knopfes, nicht
  als Wort in einem Titel. Die Aufforderung von Filmo ("Tippe auf Play, um die
  Wiedergabe zu starten") hat ihre eigene Regel und bleibt
- **Danach schrieb der Fortschritts-Takt die falsche Serie fest.** Er merkt
  sich die Adresse ganz oben und schickt das Seitenskript erst ein Dutzend
  Awaits spaeter los - Steuerung, Chat, Bildstufe, Autoplay, Marke liegen
  dazwischen. Wechselt die Folge in diesem Fenster, liest das Skript die neue
  Seite, waehrend der Aufrufer noch die alte Adresse haelt
- Jedes Ergebnis des Seitenskripts traegt jetzt seine eigene Adresse mit. Passt
  sie nicht zur Serie, fallen Titel, Titelbild und Serienlaenge heraus, und der
  bestaetigte Stand bleibt stehen. Lieber eine Angabe zu wenig als die einer
  fremden Serie
- Eine Folgenueberschrift ist kein Serientitel mehr: "Episode 21 Staffel 3 von
  Attack on Titan | AniWorld.to" wird auf "Attack on Titan" zurueckgefuehrt,
  und wo die Seite nichts hergibt, entscheidet der Serien-Slug der Adresse
  statt des letzten Pfadteils - der hiess bisher bei jeder Serie "Episode 21"
- Ein verdorbener Titel blieb nicht bei sich: er ging als Suchbegriff an die
  Metadaten und erzeugte dort einen Eintrag, der zu keiner der beiden Serien
  gehoerte - fremder Titel, eigenes Jahr, eigene IMDB-Kennung, Konfidenz
  UNMATCHED

### Leere Flaechen statt Titelbilder

- **Die Bilder waren da.** 337 Bilder auf der Startseite von AniWorld, keines
  ohne Masse, jedes vollstaendig geladen - und die Kachelreihe oben trotzdem
  dunkelblau. AniWorld blendet in seinem eigenen Stylesheet jedes Bild aus,
  das noch ein `data-src` traegt:

      .homeContentPromotionBoxPicture img[data-src],
      .seriesCoverBox img[data-src],
      .coverListItem img[data-src] { opacity: 0; }

  Sichtbar wird ein Bild dort nicht durch seine Adresse, sondern dadurch, dass
  das Lazyload-Skript das Attribut nach dem Umhaengen entfernt. Kommt dieses
  Skript nicht durch, laedt ELFIX das Bild - und die Seite versteckt es
- Die Nachreichung raeumt die Lazy-Attribute jetzt ab, genau wie das Skript der
  Seite es taete. Nur dort, wo wirklich ein Bild uebernommen wurde: sonst
  bliebe der durchsichtige Platzhalter sichtbar und nichts koennte mehr
  nachkommen
- **Karten mit gescheitertem Bild sehen nicht mehr aus wie Karten ohne Bild.**
  Es gibt eine gezeichnete Ersatzgrafik, und der Fehlschlag wird mit Zeitpunkt
  gemerkt statt als Urteil: nach fuenf Minuten ist dieselbe Adresse wieder
  einen Versuch wert, und wer wieder online geht, bekommt ihn sofort
- Frueher wurde die Adresse bei einer fehlgeschlagenen Reparatur geleert. Damit
  kostete ein Aussetzer von zehn Sekunden das Bild bis zum naechsten Neustart -
  ohne Adresse konnte die Karte nie wieder etwas anzeigen
- Und kein Kreislauf mehr: eine Adresse, die eben gescheitert ist, wird nicht
  im naechsten Zeichnen wieder in denselben `src` gesetzt

### "Werbeblocker sind auf VOE nicht erlaubt"

Bei Filmo zeigte der deutsche VOE-Stream statt des Films eine Warnung. Zwei
naheliegende Erklaerungen waren falsch, und das Nachmessen hat sie beide
ausgeschlossen: am Netz lag es nicht - im Mitschnitt fiel keine einzige Anfrage
an VOE selbst, und auch mit allen sechs geblockten Fremdhosts freigegeben blieb
die Warnung. Am Popup-Schutz lag es auch nicht - ein Spion auf `window.open`
zeigt, dass der Player es beim Klick gar nicht aufruft.

- **Es lag an einer Datei, die der Filter zu Recht abweist:** Googles
  Werbe-SDK `imasdk.googleapis.com/js/sdkloader/ima3.js`. VOEs Player fragt
  nach `google.ima`; findet er nichts, haelt er das fuer einen Werbeblocker
  und spielt nicht
- **AdGuard loest das seit Langem - aber domaingebunden.** Fuer `voe.sx` traegt
  die Regel ein `$redirect=google-ima3` ("nicht abweisen, sondern eine Attrappe
  ausliefern"), dazu sieben voe.sx-eigene Scriptlets. Gemessen an den echten
  Listen: `voe.sx` bekommt 11 Scriptlets und den Redirect,
  `tracylocalschool.com` vier Scriptlets und keinen. VOE liefert seinen Player
  naemlich laengst nicht mehr von `voe.sx`, sondern von taeglich wechselnden
  Adressen - dort greift keine dieser Regeln. Deshalb ist der Fehler
  zurueckgekommen, ohne dass an ELFIX etwas geaendert wurde
- Das SDK bleibt geblockt. In den Rahmen des Hosters wird AdGuards eigene
  Attrappe eingespielt - sie beantwortet die Frage, ob es das SDK gibt, und
  kann keine Werbung zeigen. Erkannt wird der Rahmen an der Einbettung, nicht
  am Namen: eine Liste von VOE-Adressen waere schon beim Aufschreiben veraltet
- **Im Player-Rahmen fallen die generischen Verbergen-Regeln weg**, die
  hosterspezifischen bleiben. 278 kB Selektoren gehoeren auf eine Inhaltsseite,
  nicht in einen fremden Player: dort legt ein Anti-Adblock-Skript einen Koeder
  mit genau so einem Namen an und misst seine Hoehe. Nachgemessen im laufenden
  Rahmen - ein `<div class="ad-space">` stand sofort auf `display:none`
- Popunder, Umleitungen, Werbeskripte und Tracker fallen unveraendert. Geprueft
  mit echten Klicks: der Film laeuft (1:21:27), Pause haelt, Play setzt fort,
  der Streamwechsel auf Englisch laedt neu, und der Popunder auf
  `blue-ribbonmacadamizeprovide.com` bleibt geblockt
- Jede Blockade **im Rahmen des Hosters** kommt jetzt zusaetzlich ins
  Protokoll, mit Rahmen, Typ, Ziel und Regel. Genau diese Angabe hat bei der
  Suche gefehlt: die Liste im Fenster nennt die Adresse, aber nicht, in welchem
  Dokument die Anfrage entstand - und was auf der Anbieterseite faellt, ist
  Werbung, waehrend dasselbe im Player-Rahmen der Grund sein kann, warum nichts
  mehr laeuft

### Proben

- `startknopftest` faehrt die echte Auswahl aus main.js gegen eine Seite mit
  genau der Kachel, die den Fehler ausgeloest hat - und gegen die Knoepfe, die
  weiter als Startknopf gelten muessen
- `folgentiteltest` deckt den ganzen Weg ab: Serienkennung aus Folgen-,
  Staffel- und Serienadresse, das verspaetete Ergebnis der vorigen Navigation,
  und der Cache-Eintrag, der aus einem verdorbenen Titel entstanden ist. Mit
  Gegenprobe - ohne den Riegel entsteht er wieder
- `bildfallbacktest` prueft Ersatzgrafik, Wiederholbarkeit und den fehlenden
  Kreislauf am echten Quelltext des Renderers
- `hosterplayertest` haelt fest, dass AdGuards Attrappe da ist, `google.ima`
  anlegt und nichts nachlaedt - und dass im Player-Rahmen die generischen
  Regeln weg sind, die hosterspezifischen aber nicht
- `bildnachreichungtest` misst jetzt auch, dass das Lazy-Attribut wirklich
  verschwindet - daran hing die ganze Sichtbarkeit

## 1.39.2 — 24. August 2026

Die Liste sprang beim Scrollen nach oben.

- Kein Scroll-Fehler, sondern ein Neuzeichnen. `bestandGeaendert()` baut die
  sichtbare Seite von Grund auf neu auf - `content.removeAllViews()`, und
  `mobilePage()` legt dabei eine neue ScrollView an. Die alte ist danach weg,
  samt ihrer Position, also faengt die Seite oben an
- Solange das nur nach einem eigenen Handgriff geschah, fiel es kaum auf: der
  kam ja von einer sichtbaren Stelle. Seit der Geraeteabgleich in 1.38.0 ueber
  `Bestand.setzeRoh()` hier hereinreicht, kommt es auch von aussen - ein Schub
  vom anderen Geraet, und die Liste springt unter dem Finger nach oben. Daher
  auch das "manchmal": es haengt daran, ob gerade ein Abgleich hereinkommt
- Die Position wird jetzt vor dem Neuzeichnen gemerkt und danach wieder
  gesetzt. Ausdruecklich nur an dieser Stelle und nicht in `mobilePage()`: wer
  eine Liste *oeffnet*, soll weiter oben anfangen
- `scrollTo` statt `setScrollY`, weil die ScrollView dabei auf das kappt, was
  wirklich da ist - wurde die Liste durch den Abgleich kuerzer, landet man am
  neuen Ende statt im Leeren. Und der Umweg ueber `post()`, weil die frisch
  gebaute Seite noch nicht vermessen ist; vorher waere jede Position ausserhalb
  und wuerde auf null gekappt

Nur Android. Am Rechner aendert sich nichts.

## 1.39.1 — 24. August 2026

Zwei Dinge, die auf AniWorld gemeldet wurden - beide am Rechner, beide aelter
als 1.39.0.

- **"Naechste Folge" landete bei einer fremden Serie.** Gemeldet an Attack on
  Titan: der Knopf fuehrte immer zu "Young Ladies Don't Play Fighting Games".
  Der Knopf und der Zaehler leben in der Anbieterseite - im Vollbild deckt
  deren Fenster alles zu -, und ihr Klick kommt ueber eine Konsolenzeile
  zurueck, den einzigen Kanal, den es dort ohne Preload gibt. Was dort
  hereinkam, wurde gefahren: ohne Frage, ob es dieselbe Serie ist. Jetzt steht
  ein Torwaechter davor, und was nicht die naechste Folge derselben Serie ist,
  wird nicht gefahren, sondern gemeldet
- **Der Folgenlink wurde an der blossen Nummer gesucht** - "irgendein Link, der
  auf `/episode-N+1` endet". Auf einer Anbieterseite stehen davon Dutzende: in
  "Neue Episoden", in "Das schauen andere", in der Vorschlagsspalte. An zwei
  Stellen (`readNextEpisodeLink` und der Fuehler in `messung.js`) wird jetzt
  zuerst gefragt, ob der Link ueberhaupt zu dieser Serie gehoert
- **Die Bilder auf AniWorld blieben leer.** Die Seite haengt ihre Cover nicht
  in den `<img>`, sondern daneben in `data-src`; im `src` steht ein
  durchsichtiges PNG von einem Pixel, und tauschen soll das ein Skript von
  einem fremden Wirt. ELFIX reicht solche Bilder selbst nach - nur war die
  Nachreichung blind geworden: der eingebettete Platzhalter trug keines der
  Woerter, an denen ELFIX Beiwerk erkennt, galt damit als brauchbares Bild, und
  ein Bild von einem Pixel ist sofort fertig geladen. Sie sah also ein Bild,
  das schon da war, und liess das Cover daneben liegen. Eine eingebettete
  Adresse ist jetzt nie das gemeinte Bild
- Zwei neue Proben fahren beides mit dem echten Quelltext: die Folgensuche in
  einer Seite mit genau den Links, die den Fehler ausgeloest haben, und die
  Bildnachreichung an den `<img>`, wie sie auf aniworld.to stehen

## 1.39.0 — 24. August 2026

Die APK holt auf: sie zeigt Titelbilder statt Anfangsbuchstaben, und sie
filtert Werbung nach denselben Regeln wie der Rechner statt nach Domainnamen.

### Titelbilder

- **Die Karten der APK zeigen das Titelbild** - in Weiterschauen, auf der
  Merkliste, in der Mediathek und im Verlauf, auf dem Telefon wie auf dem
  Fernseher. Das Bild fehlte nie: es steht im Eintrag und kommt sogar ueber den
  Geraeteabgleich mit. Es hat nur niemand geholt. Bis es da ist - und fuer
  Eintraege, die keines haben - bleibt der gestaltete Platzhalter mit den
  Anfangsbuchstaben stehen, es entsteht also kein Loch
- **Welches Bild zum Titel gehoert, entscheidet dieselbe Regel wie am
  Rechner.** Die Auswahl stand als Textblock mitten in `main.js` und war damit
  nur dort zu haben; sie liegt jetzt in `src/seitendaten.js`, und der Kern der
  Android-App spielt genau diesen Quelltext in die Anbieterseite ein - wie
  schon beim Messskript. Ein zweites Verfahren waere ein zweites Programm, und
  ein Bild aus der Empfehlungsspalte nebenan ist schlimmer als gar keins
- **Ein Eintrag ohne Bild bekommt eines nachgereicht**, sobald seine Seite
  offen ist. Die geteilte Regel setzt das Bild nur beim Anlegen - wer seine
  Titel vom Rechner geerbt hat oder aus einer aelteren Fassung mitbringt, saehe
  sonst dauerhaft Buchstaben. Nachgetragen wird nur, wo nichts steht, und an
  dem Eintrag, den der Kern zu dieser Adresse nennt
- Geholte Bilder liegen im Arbeitsspeicher und auf der Platte, verkleinert
  schon beim Dekodieren: eine Liste flackert beim Blaettern nicht, ein Telefon
  im Mobilfunk laedt dasselbe Poster kein zweites Mal, und vierzig Megabyte
  Ablage sind die Grenze
- Noch ohne Bild bleiben Suchtreffer: sie sind noch gar kein Eintrag, und die
  Trefferliste der Anbieter gibt keines her
- Eine neue Probe faehrt das Skript in einem nackten Kontext, wie ihn ein
  WebView stellt: es kommt ohne Electron und ohne Node aus, findet das Bild
  einer Seite - und erfindet keins, wo keins steht

### Der Werbeblocker

- **tsurlfilter faehrt jetzt in der APK mit** - dieselbe Engine, die am Rechner
  filtert, und dieselbe Datei (`adblock-engine.js`) faehrt sie. Damit gilt auf
  dem Telefon die ganze Regelsprache der AdGuard-Listen: Regeln mit Pfad,
  Bedingungen wie `$script`, `$third-party` oder `$domain=`, die Ausnahmen
  (`@@`), ueber die Captchas durchkommen - und die kosmetischen Regeln, gegen
  die ein Domainfilter grundsaetzlich nichts ausrichtet. Bisher konnte die APK
  genau eines: eine Domain sperren
- **Die Schichten ueber dem Player gehen jetzt auch nach Liste weg.** Ein
  Werbe-Overlay ist oft gar keine eigene Anfrage, sondern ein paar DIVs, die
  ein laengst geladenes Skript einhaengt - genau dafuer stehen die
  `##`-Regeln in den Listen. Die eigene Overlay-Erkennung bleibt daneben
  bestehen: die Listen kennen die benannten Werbeplaetze, sie erkennt die
  unbenannten
- **Kein Warten und kein Risiko fuer den Rest.** `shouldInterceptRequest` ist
  synchron und laeuft im Netzfaden, die Engine antwortet ueber den Hauptfaden;
  beides zusammenzuzwingen hiesse, den Netzverkehr auf die Oberflaeche warten
  zu lassen. Also entscheidet ein Zwischenspeicher, was die Engine schon
  beurteilt hat, und was neu ist, geht als Stapel hinterher - die erste
  Anfrage einer Adresse entscheidet noch die Domainliste, jede weitere die
  Engine
- **Nicht auf jedem Geraet.** Eine Regelbasis dieser Groesse kostet dauerhaft
  ein paar hundert Megabyte; auf einem Fernseh-Stick ist das nicht zu halten.
  Geraete unter drei Gigabyte bleiben deshalb bei der Domainliste - und wer
  das anders will, stellt es unter *Einstellungen > Volle Regeln* um, in beide
  Richtungen
- **Die Domainliste bleibt der Boden.** Sie filtert vor dem Aufbau, waehrend er
  laeuft und ueberall dort, wo die Engine nicht laeuft. Es gibt keinen
  Augenblick, in dem gar nichts filtert
- Die Filterlisten werden beim Laden zweimal ausgewertet: der Rohtext bleibt
  liegen (aus ihm baut sich die Engine), die Domainsperren wie bisher. Geholt
  wird weiter einmal
- Stirbt der Kern-WebView - dem Renderer kann der Speicher ausgehen -, wird er
  neu hochgezogen und jeder offene Aufruf scheitert mit einer Auskunft. Vorher
  waere das ein stiller Ausfall gewesen: Fortschritt, Watchparty und Abgleich
  haetten auf Antworten gewartet, die niemand mehr gibt
- Eine neue Probe faehrt den ganzen Weg in einem nackten Kontext: das Buendel
  entsteht, laeuft ohne Node, `adblock-engine.js` findet es, und die Bruecke
  baut daraus eine Engine, die Pfadregeln blockt, `@@`-Ausnahmen erlaubt und
  die kosmetischen Regeln fertig zum Einspielen herausgibt

## 1.38.0 — 24. August 2026

Der Geraeteabgleich hat auf dem Telefon nichts angezeigt und dabei still den
Bestand geloescht. Und die APK konnte sich nie aktualisieren - auch das lag an
etwas, das niemand sehen konnte.

### Der Geraeteabgleich

- **Das Telefon zeigte nach dem Abgleich nichts an.** Was hereinkam, ging
  direkt in `favorites.json` - am `Bestand` vorbei, der die Liste im Speicher
  haelt und aus dem Weiterschauen, Merkliste, Mediathek und Verlauf gezeichnet
  werden. Die Datei war voll, die Oberflaeche leer. Schlimmer noch: beim
  naechsten oertlichen Handgriff schrieb der Bestand seinen alten Stand
  darueber, und der Abgleich meldete den Verlust als Loeschung weiter. Der
  Abgleich geht jetzt durch den Bestand - er speichert, und die Ansicht
  zeichnet sofort neu
- **Der erste Blick loeschte den Bestand des anderen Geraets.** Eine Sekunde
  nach dem Einrichten sieht das Telefon nach, ob etwas hinaus muss. Ueber
  Mobilfunk ist der Raum bis dahin oft noch nicht da: es sah in eine leere
  Liste, bekam einen Augenblick spaeter den ganzen Bestand des Rechners - und
  schickte fuer jeden dieser Titel einen Grabstein zurueck. Danach stand die
  Mediathek auf keinem Geraet mehr. Was fehlt, gilt nur noch dann als
  geloescht, wenn die Liste juenger ist als das zuletzt Empfangene
- **Ein Geraet, dem der Bestand abhanden kam, loescht ihn nicht mehr ueberall.**
  Eine leere Liste neben einem Spiegel voller Titel ist kein Aufraeumen - wer
  aufraeumt, loescht Stueck fuer Stueck. Statt zu loeschen wird jetzt der
  Spiegel vergessen und alles noch einmal geholt. Das ist zugleich der Weg
  zurueck fuer jedes Geraet, das der alte Fehler leergeraeumt hat
- **Android schnitt beim Speichern bei sechshundert Eintraegen ab** - mit der
  Begruendung, der Rechner tue dasselbe. Er tut es nicht. Wer mehr Titel
  mitbrachte, verlor den Rest, und der Abgleich trug den Verlust auf die
  anderen Geraete weiter
- „Jetzt abgleichen" holt am Telefon jetzt den ganzen Raum noch einmal, genau
  wie am Rechner. Nur nachzusehen, ob etwas hinaus muss, hilft dem nicht, der
  den Knopf drueckt - wer ihn drueckt, vermisst etwas
- Der Status zaehlt Titel und nicht mehr die Groesse des Spiegels.
  „231 Titel" neben einer leeren Mediathek waren Wiedergabesitzungen und
  Grabsteine und schickten beim Suchen in die falsche Richtung
- Zwei neue Proben mit der echten Android-Bruecke halten beides fest: der Blick
  vor dem Zustand und das Telefon ohne Bestand. Gegen den alten Stand
  gefahren, bleiben von zwoelf Titeln null uebrig

### Die APK bringt sich selbst auf den neuesten Stand

- **Jede je gebaute APK trug eine andere Unterschrift.** Der Workflow baute
  `assembleDebug`, und Gradle unterschreibt dann mit `~/.android/debug.keystore` -
  den legt jede Maschine selbst an, mit einem *zufaelligen* Schluessel. Auf
  einem GitHub-Runner, der nach jedem Lauf verschwindet, hiess das: Android
  verweigerte jedes Update, und der einzige Weg war Deinstallieren - mitsamt
  allem, was auf dem Geraet stand. Die APK wird jetzt mit einem festen
  Schluessel unterschrieben, der als Geheimnis hereinkommt
- **Und jede trug dieselbe Fassungsnummer** (`versionCode 150`, `versionName
  1.5.0`), fest in `build.gradle`. Android entscheidet an genau dieser Nummer,
  ob eine APK neuer ist, und die App konnte gar nicht ablesen, ob es etwas
  Neueres gibt. Beides kommt jetzt aus dem Tag: `v1.38.0` wird zu `1.38.0` und
  `versionCode 13800`
- ELFIX sieht beim Start nach neuen Fassungen - hoechstens alle sechs Stunden -,
  laedt sie im Hintergrund und fragt dann einmal. Wer „Spaeter" sagt, wird zu
  dieser Fassung nicht noch einmal gefragt; sie bleibt in den Einstellungen
  stehen
- Installiert wird nie von allein. Das kann eine App auf Android auch nicht:
  der Paketinstaller zeigt immer seinen eigenen Dialog, und die Erlaubnis
  „Unbekannte Apps installieren" muss einmal von Hand gegeben werden. Fehlt
  sie, schickt ELFIX auf die richtige Systemseite statt eine Fehlermeldung
  anzuzeigen
- Neue Karte in den Einstellungen, auf dem Telefon wie am Fernseher: welche
  Fassung laeuft, was gerade geschieht, und ein Knopf, der sofort nachsieht
- Nach draussen geht dabei eine Anfrage an die oeffentliche GitHub-API und,
  wenn wirklich etwas Neues da ist, das Herunterladen der Datei. Kein Konto,
  keine Kennung, nichts ueber das Geraet

**Einmalig noch von Hand:** die gerade installierte APK traegt eine der alten
Zufallsunterschriften. Diese eine Fassung muss deshalb noch deinstalliert und
neu installiert werden - ab da laeuft es von selbst. Vorher den
Geraeteabgleich einschalten, dann steht der Bestand nachher wieder da.

Android traegt ab hier dieselbe Fassungsnummer wie der Rechner. Die bisherige
Zaehlung (zuletzt 1.5.0) war eine zweite Buchfuehrung fuer dasselbe Programm.

## 1.37.2 — 24. August 2026

Und noch einmal die Umgebung, nicht der Code.

- Die Probe des Geraeteabgleichs laesst die echte Android-Bruecke laufen. Die
  gibt `geraete.js` keine WebSocket-Klasse mit, weil es im WebView nichts
  mitzugeben gibt - dort ist WebSocket eine Globale. Node bringt die erst ab
  Fassung 22 mit, der Bau-Server faehrt 20: hier gruen, dort rot
- Die Probe stellt die Globale jetzt selbst bereit und bildet damit die
  WebView-Umgebung nach, statt sich auf die des Rechners zu verlassen.
  Nachgewiesen mit geloeschter Globale: 18/18, also genau der Fall des
  Bau-Servers

An ELFIX selbst aendert sich wieder nichts. Android bleibt bei 1.5.0.

## 1.37.1 — 24. August 2026

Ein Test, der die Maschine geprueft hat statt den Code.

- Die neue Probe des Geraeteabgleichs wartete feste Zeitspannen auf einen
  Abgleich ueber eine echte Verbindung. Auf diesem Rechner genuegten 900 ms, auf
  dem Bau-Server nicht - der Lauf von 1.37.0 ist daran gescheitert, ohne dass am
  Abgleich selbst etwas falsch war
- Jetzt wird auf das Eintreten gewartet und nicht auf die Uhr: hoechstens 15
  Sekunden, und im Regelfall ist es nach Millisekunden vorbei. Nur an der einen
  Stelle, an der geprueft wird, dass *nichts* geschieht, steht weiterhin eine
  feste Spanne - darauf laesst sich nicht warten
- Dazu jede Behauptung gegen einen fehlenden Wert abgesichert. Ein Abbruch
  mitten in der Probe verdeckte vorher die Pruefungen darueber

An ELFIX selbst aendert sich nichts. Android bleibt bei 1.5.0.

## 1.37.0 — 24. August 2026

„Meine Geräte" gibt es jetzt auch am Telefon und am Fernseher.

**Denselben Schlüssel eintragen, und der Stand läuft zusammen**

- Was am Rechner läuft, steht am Handy in „Weiterschauen" an derselben Stelle -
  und umgekehrt. Kein Konto, kein Raum: ein Schlüssel, den nur die eigenen
  Geräte kennen
- Abgeglichen wird dasselbe wie am Rechner: Folge, Stelle, abgeschlossene
  Titel, die Reihenfolge in der Mediathek und die gemessene Wiedergabezeit
- Auf dem Gerät bleiben: selbst gewählte Bilder, der Verlauf je Eintrag und
  alles, was zu einer Watchparty gehört
- Der Server sieht nichts davon. Die Einträge sind verschlossen, bevor sie das
  Gerät verlassen; der Schlüssel geht nie hinaus und steht in keiner
  Protokollzeile

**Kein zweiter Abgleich, sondern derselbe**

- Verbindung, Wiederanschluss, Uhrabgleich, Spiegel, Grabsteine und die Frage,
  welcher Stand gewinnt, laufen auf beiden Geräten in denselben Dateien. Ein
  zweiter Abgleich wäre ein zweiter Abgleich - und zwei Geräte kämen an
  derselben Stelle zu verschiedenen Ergebnissen
- Was beim Übernehmen mit einem Stand geschieht, lag bis hierher in `main.js`
  und war damit an Electron gebunden. Es steht jetzt in `geraete-stand.js`;
  der Rechner reicht fünf Rückrufe hinein und verhält sich unverändert

**Das Hindernis war die Krypto**

- Der Schlüssel wird synchron abgeleitet und synchron verschlüsselt; die
  WebCrypto-API des WebViews kann das nur mit Versprechen. Also liefert Java
  die Grundrechenarten, und der Kern übersetzt darauf
- Belegt statt behauptet: Prüfvektoren aus Node gegen javax.crypto (17/17), das
  echte Schlüsselmodul durch den Ersatz gefahren (24/24), und Rechner gegen
  Telefon an einem echten Relay mit der Brücke aus dem Paket der App (18/18) -
  darunter der teuerste Fall überhaupt: ein leeres Telefon darf den Bestand des
  Rechners nicht überschreiben

**Am Telefon anders als am Rechner, und mit Absicht**

- Am Rechner steht das Schlüsselfeld neben vier Knöpfen in einer Zeile. Auf
  sechs Zoll wären das vier Ziele von je zwei Zentimetern - hier stehen sie
  untereinander und sind daumenhoch. Am Fernseher nebeneinander und mit
  Fokusrahmen
- Der Status sagt, was wirklich los ist: nicht verbunden, keine Server-Adresse,
  wird verbunden, oder verbunden samt Anzahl und Uhrzeit. Jeder Fall braucht
  einen anderen Handgriff
- Kommt die Leitung zurück, wird sofort abgeglichen statt bis zu einer Minute
  gewartet

**Noch nicht auf einem Gerät bestätigt**

- Wie schon in 1.36.0: geprüft sind Build und Logik, nicht der Lauf auf echter
  Hardware

## 1.36.0 — 24. August 2026

Android hoert auf, ELFIX ein zweites Mal zu sein.

**Die Regeln stehen jetzt einmal**

- Die Android-App hatte die Geschaeftslogik von ELFIX in Java nachgebaut: 37
  gleichnamige Funktionen, von Hand nachgezogen und laengst auseinander-
  gelaufen. Zwei Abschriften derselben Regel laufen auseinander, sobald nur
  eine gepflegt wird
- Statt weiter abzuschreiben laedt die App die Original-Module in einen
  unsichtbaren WebView. Sie brauchen kein Electron und kein Node, sondern nur
  `fetch`, `WebSocket` und `setTimeout`. Ein Kopierschritt beim Bauen sorgt
  dafuer, dass immer dieselbe Fassung laeuft wie am Rechner
- Die Fortschrittsregel wandert dafuer aus `main.js` nach `fortschritt.js`, die
  Messung nach `messung.js`. Am Rechner aendert sich dadurch nichts - dieselben
  Namen, dieselben Aufrufstellen
- Belegt statt behauptet: 14 Faelle der Fortschrittsregel fahren auf beiden
  Geraeten, der Rechner ueber `fortschritttest`, das Telefon beim Start

**Sub bleibt Sub - auch am Telefon**

- Womit du eine Serie angefangen hast, steht ab der zweiten Folge vorgewaehlt
  da. Bisher klickte man die Flaggenreihe bei jeder Folge neu, mit dem Daumen
- Der Autostart wartet auf die Umschaltung, bevor er einen Hoster anklickt: die
  Anbieterseite zeigt nur die Hoster der gewaehlten Fassung
- `fassungen.json` hat auf beiden Geraeten dasselbe Format - der Abgleich kann
  sie spaeter ohne Uebersetzung mitnehmen

**Der Weg in den Rahmen des Hosters**

- Das Video liegt nicht auf der Anbieterseite, sondern in einem Rahmen von
  einem fremden Wirt. Dorthin reichte auf Android nichts: drei Funktionen des
  Rechners waren damit gar nicht zu haben
- Jetzt schon - ueber die beiden AndroidX-Gegenstuecke zu dem, was Electron
  mitbringt. Damit kommen **Intro ueberspringen** (gelernt aus den eigenen
  Spruengen) und die **beste Bildstufe beim Hoster** auf Android an, und die
  Fortschrittsmessung sieht endlich, was wirklich laeuft
- Ist die System-WebView zu alt (aelter als 83), faellt alles still auf das
  Hauptdokument zurueck - und die Einstellungen sagen es, statt einen Schalter
  anzubieten, der nichts bewirkt
- Ein Punkt ist auf Android bewusst besser geloest als am Rechner: wird "Intro
  ueberspringen" mitten in einer Folge abgeschaltet, hoert das Telefon sofort
  auf zu lernen

**Neu geprueft**

- `brueckentest` fuehrt die Android-Bruecken wirklich aus und haelt ihre
  Schluessel gegen die, die `main.js` bildet. Laufen die auseinander, merken
  sich beide Geraete dasselbe und finden das des anderen nie wieder - ohne
  diesen Test waere das still passiert

**Noch nicht auf einem Geraet bestaetigt**

- Rahmenzugriff, Intromarke, Bildstufe und die Messung im Rahmen sind gebaut
  und gegen die geteilten Module geprueft, aber zur Laufzeit noch nicht auf
  einem Telefon oder Fernseher nachgemessen

## 1.35.1 — 23. August 2026

Warum sich die Fernbedienung nicht installieren liess - und warum das dreimal
nicht zu finden war.

**Der Grund: das Relay war zu alt**

- Manifest, Symbole und Service Worker kamen erst mit 1.34.0 dazu. Die App
  aktualisiert sich von selbst, das Relay wird von Hand kopiert - wessen
  `.js`-Dateien vom Stand 1.33.0 sind, bekommt am Handy eine Seite ganz ohne
  Manifest
- Die sieht gleich aus, die Fernbedienung funktioniert, und Chrome bietet
  trotzdem nur "Zum Startbildschirm hinzufuegen" an. Das ist eine Verknuepfung
  mit Browserleiste, keine App - und Chrome sagt nirgends, warum
- Nachgemessen statt vermutet: mit der Seite von 1.33.0 meldet Chromium
  `no-manifest`, mit der aktuellen Seite null Beanstandungen. Auch die
  Selbstauskunft aus 1.35.0 half hier nicht - sie steht in derselben Seite, die
  vom alten Relay gar nicht erst kommt

**Also fragt ELFIX jetzt nach**

- `/health` weist mit `fernapp` aus, dass die ausgelieferte Seite Manifest,
  Symbole und Service Worker mitbringt. Getrennt von `fern`, das es seit
  1.33.0 gibt
- Unter *Einstellungen > Fernbedienung* steht eine Zeile **Relay**, sobald
  etwas im Weg ist: "zu alt zum Installieren" samt Handgriff, "nicht
  erreichbar" oder "kein https". Steht dort nichts, ist drueben alles in
  Ordnung
- Ein Blick pro Minute, nicht pro Tastendruck

**Und ein Fehler, der noch niemandem aufgefallen ist**

- `start_url`, `scope` und die Symbolpfade im Manifest standen ab der Wurzel.
  Haengt das Relay hinter einem Vorspann wie `/elfix/`, zeigten sie ins Leere -
  installieren liess sich die App noch, aber sie oeffnete danach eine
  404-Seite. Jetzt stehen sie relativ und werden gegen die Adresse des
  Manifests aufgeloest
- Die feste `id` faellt damit weg: Chrome leitet sie aus `start_url` ab, und die
  ist jetzt an jeder Stelle die richtige
- `prefer_related_applications: false` steht ausdruecklich da. Es ist der
  Vorgabewert, aber es ist auch die einzige Angabe im Manifest, mit der man die
  Installation abschalten koennte - wer dort sucht, soll die Antwort sehen

## 1.35.0 — 23. August 2026

Die Fassung bleibt gemerkt, die Fernbedienung kann jetzt auch anfangen, und sie
sagt selbst, warum Chrome sie nicht installieren will.

**Sub bleibt Sub**

- AniWorld und S.to legen jede Folge einmal je Synchronfassung ab, und die
  Flaggenreihe steht bei jeder neuen Folge wieder auf der Vorgabe des
  Anbieters. Wer eine Serie mit Untertiteln schaut, hat das bisher zwanzig Mal
  angeklickt
- Jetzt sagt die erste Folge, womit man angefangen hat, und ab der zweiten
  klickt ELFIX die Flagge selbst an. Kein Erkennen, kein Raten - gelernt wird
  aus dem, was jemand selbst tut, wie beim Intro
- Was beim Laden dasteht, ueberschreibt nie eine gelernte Fassung: das ist die
  Vorgabe des Anbieters und keine Entscheidung. Sonst haette die Vorwahl sich
  nach der ersten Folge selbst wieder abgewaehlt
- Und der eigene Klick der Vorwahl zaehlt auch nicht - nur ein Klick mit
  `isTrusted` ist einer von einem Menschen
- Der Autostart wartet, bis die Fassung steht. Das ist der eigentliche Punkt:
  die Seite zeigt nur die Hoster der gewaehlten Fassung, und wer davor auf
  einen Hoster klickt, startet die falsche und merkt es erst am Ton. Hoechstens
  vier Sekunden, und nur, wenn ueberhaupt etwas umzustellen ist
- Gibt es die gemerkte Fassung bei einer Folge nicht, bleibt stehen, was der
  Anbieter anbietet
- Ab- und anschalten unter *Einstellungen > Wiedergabe*, mit Anzeige und
  **Vergessen** - dieselbe Zeile wie bei den Intros

**Aussuchen statt nur druecken**

- Unter den Knoepfen steht "Weiterschauen": die angefangenen Serien dieses
  Rechners, mit Folge und Fortschrittsbalken. Ein Tipp oeffnet den Eintrag und
  spielt ihn an - bisher konnte die Fernbedienung nur bedienen, was schon lief,
  und wer vom Sofa aus anfangen wollte, musste doch aufstehen
- Drei Knoepfe mehr: vorherige Folge, lauter, leiser. Lauter hebt nebenbei die
  Stummschaltung auf - lauter zu stellen, was stumm ist, waere folgenlos
- Was hinausgeht, ist damit mehr als vorher, und das steht auch so im README:
  Wer den Kopplungscode hat, sieht Titel und Folge der angefangenen Serien.
  Adressen, Verlauf und Mediathek bleiben hier, und das Handy schickt nie eine
  Adresse, sondern nur die Kennung eines Eintrags, den ELFIX selbst
  herausgegeben hat

**"Es installiert nicht" ist keine Sackgasse mehr**

- Chrome nennt seine Gruende in der Entwicklerkonsole. Am Handy kommt da
  niemand hin, und uebrig bleibt eine Verknuepfung mit Browserleiste, ohne dass
  jemand erfaehrt, woran es lag
- Darum fragt die Seite jede Bedingung selbst ab und schreibt sie hin: https,
  Service Worker vorhanden, Service Worker laeuft (mit seiner Fehlermeldung,
  falls nicht), Manifest ladbar, beide Symbole ladbar, Angebot von Chrome da.
  Die Auskunft steht nur da, solange das Installieren nicht geht
- Der haeufigste Grund steht dabei ganz oben: ueber `http` - eine nackte IP im
  WLAN - bietet Chrome grundsaetzlich keine Installation an, sondern nur die
  Verknuepfung. Der Cloudflare Tunnel erfuellt die Bedingung, der Umweg ueber
  die lokale Adresse nicht

**Unter der Haube**

- `fnliste` und `fnoeffnen` im Relay: die Frage geht durch, die Antwort wird
  gekuerzt (40 Eintraege, feste Felder). Was auf der Liste steht, entscheidet
  ELFIX - das Relay sieht sie nur im Vorbeigehen
- `favoritOeffnen` ist aus dem IPC herausgeloest, weil jetzt zwei Wege dorthin
  fuehren: die Oberflaeche und das Handy

## 1.34.0 — 21. August 2026

Ein QR-Code fuer die Fernbedienung, und zwei Dinge an ihr, die nicht stimmten.

**Scannen statt abtippen**

- Neben dem Kopplungscode steht jetzt ein QR-Code. Wer ihn mit der Kamera
  scannt, hat die Fernbedienung offen und ist gekoppelt, ohne etwas getippt zu
  haben - die Adresse traegt den Code mit
- Aus der Adresszeile verschwindet er sofort wieder. Ein Geheimnis hat weder im
  Verlauf des Browsers noch in einem geteilten Link etwas verloren
- Gerechnet wird der Code selbst. ELFIX hat zwei Laufzeit-Abhaengigkeiten und
  das Relay keine einzige; im README steht ausdruecklich, dass ein `npm ci`
  beim Aktualisieren nie noetig war. Ein Bildchen ist kein Grund, das
  aufzugeben
- Byte-Modus, Fehlerkorrektur M, Fassungen 1 bis 10 - das reicht fuer 213
  Zeichen, und eine Adresse mit Code ist halb so lang

**Vollbild meint den Player**

- Der Knopf machte das Fenster gross. Das ist nicht dasselbe: die Anbieterseite
  fuellt dann den Bildschirm, das Video sitzt aber weiter in seinem Kasten
  mittendrin, mit Kopfzeile und Empfehlungen ringsum
- Jetzt wird der Player gefragt, so wie es ein Klick auf seinen eigenen Knopf
  taete. Das Fenster bleibt der Rueckfall, wenn kein Video da ist oder der
  Rahmen kein Vollbild zulaesst
- Genommen wird das groesste sichtbare Video - auf Anbieterseiten liegen
  Vorschauen in Briefmarkengroesse daneben
- Dieselbe Aenderung fuer `F11`: auch dort war es bisher das Fenster

**Installieren, das wirklich installiert**

- Chrome fiel auf eine blosse Verknuepfung zurueck, und die oeffnet mit
  Browserleiste. Drei Dinge daran waren zu holen
- Die Seite trug nur die veraltete Apple-Angabe. Chrome sagt das sogar in der
  Konsole und fragt nach `mobile-web-app-capable` - jetzt steht beides da
- Das Manifest nannte nur ein Symbol. Jetzt sind es beide Groessen, die Chrome
  kennt: 192 fuer den Startbildschirm, 512 fuer alles Groessere
- Und es hat eine eigene Kennung. Ohne sie nimmt Chrome die Startadresse dafuer
  - aendert die sich einmal, gilt es als andere App und liegt zweimal auf dem
  Startbildschirm
- Vor allem aber sagt die Seite jetzt, wenn es *nicht* geht: ohne `https` gibt
  es keinen Service Worker und damit kein Installieren. Das ist der haeufigste
  Fall und der unauffaelligste - vorher passierte schlicht nichts

**Geprueft**

- Der QR-Code laesst sich nicht ansehen, sondern nur lesen: ein falscher sieht
  vollkommen richtig aus. Beim Bauen lag die Formatangabe transponiert, und
  aufgefallen ist das erst, als ein fremder Decoder nichts fand
- Nachgerechnet wird die Fehlerkorrektur gegen die Musterloesung der Norm, dazu
  jede Fassungsgrenze und der Aufbau des Musters. Fuer das Ganze steht ein
  Fingerabdruck: drei Codes, einmal mit einem fremden Leser geprueft und
  seither festgeschrieben
- Fuer das Installieren wird jede Bedingung einzeln geprueft - die Umleitung
  auf `/fern/`, das Manifest samt Geltungsbereich, beide Symbole in der
  Groesse, die das Manifest behauptet, und der Service Worker mit seiner
  fetch-Behandlung. Keine davon meldet sich, wenn sie fehlt

## 1.33.0 — 21. August 2026

Das Handy wird zur Fernbedienung. Ohne App - eine Seite im Browser genuegt.

**Vom Sofa aus**

- Unter *Einstellungen > Fernbedienung* einschalten, im Handybrowser
  `…/fern` oeffnen, den Kopplungscode eintippen. Das war es; das Handy merkt
  ihn sich und ist beim naechsten Mal sofort da
- Sechs Knoepfe: 10 Sekunden zurueck, Pause/Weiter, 30 Sekunden vor, Ton aus,
  Vollbild, naechste Folge. Vorwaerts weiter als rueckwaerts - nach vorn spult
  man ueber etwas hinweg, zurueck holt man etwas nach, das man eben verpasst hat
- Daneben steht, was laeuft: Titel, Folge, Stelle, Fortschrittsbalken
- Gesteuert wird immer, was gerade vorn liegt. Eine Fernbedienung bedient das,
  was zu sehen ist, und nicht eine Seite, die vorhin einmal offen war
- Die naechste Folge rechnet dieselbe Adresse aus wie der Knopf im Bild und das
  Tastenkuerzel - drei Wege, eine Regel

**Die Seite kommt aus dem Relay**

- Ausgeliefert unter `/fern`, in einem Stueck: kein Stylesheet, kein Skript von
  aussen. Sie laedt oft ueber Mobilfunk und soll dann sofort dastehen
- Sie steht als Zeichenkette in `fern-seite.js` und nicht als `.html` daneben.
  Das README sagt beim Aktualisieren des Relays "alle .js-Dateien kopieren", und
  eine einzelne HTML-Datei waere genau die, die dabei jedes Mal liegenbliebe -
  dann liefe der Dienst mit neuem Code und alter Seite
- Wacht das Handy aus dem Ruhezustand auf, verbindet sie sich von selbst neu.
  Ein Telefon schlaeft ein, sobald man es weglegt

**Als App auf dem Startbildschirm**

- Ein Knopf *Als App installieren* auf der Seite selbst - im Chrome-Menue ist
  das gut versteckt. Danach liegt die Fernbedienung als eigenes Symbol auf dem
  Handy, oeffnet ohne Browserleiste und startet mit dem letzten Code
- Dafuer liefert das Relay Manifest, Symbol und Service Worker mit. Chrome
  bietet das Installieren nur an, wenn alle drei da sind - und nur ueber
  `https`. Ueber den Cloudflare Tunnel ist das erfuellt, ueber eine nackte IP im
  WLAN nicht
- `/fern` leitet auf `/fern/` um. Der Service Worker gilt fuer sein Verzeichnis,
  und eine Startadresse ohne Schraegstrich laege ausserhalb - Chrome verweigerte
  dann die Installation
- Das Symbol ist der ELFIX-Mark auf dem dunklen Grund der App, auf 62 Prozent
  der Flaeche: so schneidet ein rundes oder abgerundetes Ausschneiden nichts ab
- Der Service Worker haelt die Seite vor, aber nur als Rueckfall - geladen wird
  immer erst aus dem Netz. Sonst stuende nach einem Aktualisieren des Relays
  wochenlang die alte Fassung da. Ohne Verbindung oeffnet sie trotzdem und sagt
  selbst, dass gerade nichts geht
- Symbol und Seite liegen als Zeichenketten in `.js`-Dateien. Beim Aktualisieren
  des Relays werden nur solche kopiert, und ein Startbildschirm-Symbol, das ins
  Leere zeigt, faellt erst auf, wenn jemand sein Handy neu einrichtet

**Was durchgeht - und was nicht**

- Vom Rechner zum Handy: Titel, Folge, Stelle, laeuft oder nicht. Keine Liste,
  kein Verlauf, keine Adresse. Wer den Code hat, kann druecken, nicht mitlesen
- Vom Handy zum Rechner: acht feste Befehlswoerter. Eine Liste im Relay und
  keine durchgereichte Zeichenkette - was die Fernbedienung kann, entscheidet
  ELFIX und nicht das, was jemand in eine Nachricht schreibt
- Der Code ist acht Zeichen aus zweiunddreissig, also vierzig Bit, und nach drei
  Fehlversuchen ist fuer diese Verbindung Schluss. Durchprobieren geht damit
  nicht
- Ausschalten nimmt jedem Handy die Moeglichkeit, auch dem, das den Code kennt.
  Ein neuer Code loest alle gekoppelten
- Geht ELFIX aus, erfahren die Handys es und der Code koppelt niemanden mehr.
  Eine Kopplung ohne Gegenstelle waere ein Knopf ins Leere
- Der Stand geht nur hinaus, wenn er sich geaendert hat, und die Stelle zaehlt
  sekundenweise. Sonst liefe je Takt eine Nachricht durch die Leitung, auch wenn
  das Bild seit zehn Minuten steht

**Geprueft**

- Gegen das echte Relay, mit beiden Seiten an einer echten Verbindung. Die
  Haelfte gilt dem, was nicht durchgeht: ein falscher Code, ein fremder Code,
  ein Befehl, den es nicht gibt, ein Rechner, der sich selbst steuern will, und
  zwei Kopplungen, die einander nicht in die Quere kommen duerfen
- Dazu die Frage, die sonst erst am toten Knopf auffiele: kennt jede Seite
  dieselben Befehle? Geprueft wird, dass jedes Wort aus dem Relay im
  Hauptprozess behandelt wird und jeder Knopf der Seite eines davon ist

**Relay**

- Neue Dateien `fern.js`, `fern-seite.js` und `fern-icon.js`. `/health` weist die
  Fernbedienung unter `features` als `fern` aus und zaehlt unter
  `fernbedienungen`, wie viele Rechner gerade steuerbar sind

## 1.32.1 — 21. August 2026

Die Leiste links oben blendete sich von selbst ein, immer wieder, ohne dass
jemand die Maus bewegt hatte.

**Der Takt statt der Maus**

- Chat und Autoplay-Schalter verblassen nach dreieinhalb Sekunden Stille - wer
  schaut, bewegt die Maus nicht. Zurueckholen sollte sie nur eine Bewegung
- Beide Skripte werden aber im Fortschritts-Takt erneut eingespielt, alle paar
  Sekunden, und beide weckten die Leiste bei jedem Durchlauf auf. Das Ergebnis
  war ein Blinken waehrend der ganzen Folge: kurz weg, wieder da, kurz weg
- Erneut eingespielt wird jetzt still. Der Chat bleibt, wie er ist; der
  Schalter zieht den Stand nach, ohne sich zu melden
- Nur wenn sich wirklich etwas geaendert hat, blendet sich noch etwas ein: eine
  eingehende Chatzeile, oder ein Schalter, der in den Einstellungen umgelegt
  wurde, waehrend die Folge lief. Das ist eine Nachricht und kein Takt
- Der Fehler steckte seit 1.28.1 im Chat und seit 1.30.0 im Schalter. Beide
  Suiten pruefen jetzt genau das: ein zweites Einspielen darf nichts sichtbar
  machen, eine echte Aenderung schon

## 1.32.0 — 21. August 2026

Der Rueckblick zaehlt jetzt alles zusammen. Bisher zeigte jedes Geraet seine
eigene Haelfte.

**Wiedergabezeit gehoert dazu**

- Seit 1.31.0 gleichen die Geraete ihren Stand ab - die gemessene Zeit aber
  nicht. Wer abends am Rechner und am Wochenende auf dem Laptop schaut, sah
  zweimal die halbe Bilanz. Vorher war das folgerichtig: die Zahlen sagten,
  was *dieses* Geraet gesehen hat. Seit die Titel mitwandern, war es ein
  Widerspruch
- Sitzungen gehen jetzt denselben Weg wie die Staende, aber nach anderen
  Regeln. Ein Stand aendert sich - eine abgeschlossene Sitzung nie. Sie kommt
  dazu oder sie ist schon da; ueberschrieben wird nichts, und einen Grabstein
  gibt es nicht. Zwei Geraete koennen denselben Satz nicht verschieden wissen
- Die gerade laufende Sitzung bleibt, wo sie ist. Sie waechst noch, und
  drueben stuende sie als fertiger Satz da - ihre halbe Stunde zaehlte als
  ganze
- Verschickt wird in Schueben. Beim ersten Abgleich eines Geraets sind das
  leicht ein paar tausend Saetze, und die will niemand auf einmal durch eine
  Leitung schieben, an der nebenbei eine Folge laeuft

**Wann sind zwei Saetze dieselbe Folge?**

- Daran haengt alles, und die bisherige Antwort taugte nicht mehr: es war die
  Kennung des Favoriten. Auf einem Geraet ist die eindeutig - sie entsteht
  aber beim Anlegen und ist auf jedem Geraet eine andere. Zusammengelegt
  stuende dieselbe Folge zweimal da, und zwar ohne dass es auffiele: die
  Stundenzahl bliebe richtig, nur die Zahl der Folgen waere zu hoch
- Jetzt entscheidet der Titel, mit derselben Normalisierung wie ueberall sonst
  in ELFIX. Nebenbei raeumt das einen alten Fehler mit auf: wer eine Serie bei
  zwei Anbietern schaute, hatte zwei Favoriten - und damit doppelt so viele
  Folgen in der Bilanz
- Dieselbe Umstellung bei den Saetzen, die 1.28.0 aus dem Verlauf uebernommen
  hat. Ihre Kennungen werden einmalig umgerechnet, Doppelgaenger fallen dabei
  weg. Ohne das truege jedes Geraet dieselbe Vorgeschichte noch einmal
- Gemessen schlaegt rekonstruiert: liegt zu einer Folge beides vor - das eine
  Geraet hat sie gemessen, das andere sie beim Einrichten aus dem Verlauf
  nachgetragen -, faellt der rekonstruierte Satz weg. Er beschreibt dasselbe
  Ansehen und weiss weniger darueber

**Eine Folge zaehlt einmal**

- Fuer die Gesamtzahl galt das immer. Die Zahlen je Tag, Wochentag, Monat und
  Titel zaehlten dagegen Sitzungen, und auf einem Geraet fiel der Unterschied
  kaum auf. Wer eine Folge auf dem Rechner anfaengt und auf dem Laptop zu Ende
  sieht, haette sie dort sonst zweimal stehen
- Die Saetze werden vor dem Zaehlen nach Zeit sortiert. Seit sie von mehreren
  Geraeten kommen, ist die Reihenfolge in der Ablage die des Eintreffens und
  nicht die des Schauens - ohne diese Zeile haenge daran, welchem Tag eine
  Folge zugerechnet wird

**Intro ueberspringen**

- Gelernt statt erkannt. Ein Intro zu erkennen geht hier nicht - ELFIX sieht das
  Video nie, es liegt im Rahmen des Hosters. Also andersherum: wer eine Serie
  schaut, spult das Intro selbst weg, jede Folge an derselben Stelle. Der Player
  meldet Anfang und Ziel eines Sprungs auf die Sekunde
- Aus zwei aehnlichen Sprüngen in zwei **verschiedenen** Folgen derselben
  Staffel wird eine Marke, und ab der naechsten Folge steht dort ein Knopf. Ein
  einzelner Sprung kann Langeweile gewesen sein; zweimal in derselben Folge ist
  Herumspulen, und dort zaehlt der letzte
- Gesprungen wird nur auf Druck. Derselbe Grund wie bei der Bildstufe in
  1.29.0: ein Skript, das ungefragt eingreift, ist eine Bevormundung - und ein
  falscher Sprung kostet neunzig Sekunden Handlung, die man erst wiederfinden
  muss
- Gelernt wird nur, was ein Intro sein kann: vorwaerts, 20 bis 180 Sekunden, in
  den ersten zehn Minuten. Was spaeter uebersprungen wird, ist Handlung
- Je Titel und Staffel, nicht je Folge und nicht je Adresse. Intros wechseln
  zwischen Staffeln, und ein Anbieterumzug soll das Gelernte nicht mitnehmen
  muessen
- Aendert sich das Intro mitten in der Serie, zieht die Marke nach: gerechnet
  wird der Median der groessten uebereinstimmenden Gruppe. Ein einzelner
  Ausreisser verzieht sie nicht
- Der eigene Knopf zaehlt nie als Beleg. Lernte die Marke von sich selbst,
  verschoebe sie sich mit jedem Druck ein Stueck weiter, und niemand koennte
  sagen, warum das Intro nach zehn Folgen mitten in der Handlung anfaengt
- Waehrend einer Watchparty wird nicht gelernt. Dort zieht der Host den Player,
  und diese Sprünge sind nicht die Entscheidung dessen, der hier sitzt
- Abspanne bleiben aussen vor: was am Ende zu tun ist, weiss ELFIX laengst -
  dort steht der Knopf zur naechsten Folge
- Unter *Einstellungen > Wiedergabe* abschaltbar, mit Anzeige, fuer wie viele
  Serien etwas gelernt wurde, und einem **Vergessen**

**Tastenkuerzel**

- Fuenf Stueck, und es gab bisher kein einziges: `Strg + K` fuer die Suche,
  `Alt + ←` fuer zurueck, `F11` fuers Vollbild, `Strg + →` fuer die naechste
  Folge und `Strg + Umschalt + W` fuer *Wofuer zaehlt das hier?*
- Sie gelten auch, waehrend eine Anbieterseite vorn liegt. Genau deshalb haengen
  sie im Hauptprozess: die Anbieterseite ist eine eigene Ansicht **ueber** der
  Oberflaeche, und ein Tastendruck dort erreicht den Renderer nie. Ein
  systemweites Kuerzel waere das andere Extrem - das naehme die Taste auch jedem
  anderen Programm weg
- Was gerade nichts bedeutet, bedeutet nichts: `Alt + ←` ohne Verlauf,
  `Strg + →` ausserhalb einer Folgenseite und `F11` ohne geoeffnete
  Anbieterseite werden an die Seite durchgereicht, statt geschluckt zu werden.
  Jede Taste, die hier abgefangen wird, fehlt der Anbieterseite - abgefangen
  wird deshalb nur, was wirklich etwas tut
- Jedes Kuerzel traegt eine Zusatztaste oder ist eine Funktionstaste. Ein
  blosses `n` waere im Suchfeld einer Anbieterseite ein Aerger
- `F11` machte bisher das Falsche: Electron legt darauf von Haus aus sein
  Fenster-Vollbild, und das kennt weder die Bildflaeche noch die Einblendung
  zum Verlassen. Jetzt ist es das Vollbild von ELFIX - solange eine
  Anbieterseite offen ist. Sonst bleibt es beim alten Verhalten
- Nachzulesen unter *Einstellungen > Wiedergabe*
- Das Escape aus dem Vollbild stand bis dahin an zwei Stellen mit demselben
  Code. Beide rufen jetzt dieselbe Weiche

**Anbieter umziehen**

- Wechselt AniWorld oder S.to die Adresse, zeigt jeder Eintrag ins Leere:
  Watchlist, Mediathek, abgehakte Folgen, Verlauf und die Vorschaubilder gleich
  mit. Von Hand ist das ein Nachmittag
- Neuer Knopf unter *Einstellungen > Anbieter*: neue Adresse ins Feld
  **Website**, dann **Adresse hat sich geaendert**. Kein zweites Eingabefeld
  dafuer - das waere ein zweiter Ort fuer dieselbe Angabe, und man muesste sie
  zweimal richtig eintippen
- Vor dem Umschreiben kommt eine Rueckfrage, und sie sagt, was passieren wird:
  wie viele Eintraege mitziehen, wie viele davon in der Mediathek stehen, wie
  viele Bilder betroffen sind. Gerechnet wird vorher, geschrieben erst danach -
  was der Bericht nennt, ist genau das, was hinterher anders ist
- Umgezogen wird ausschliesslich der Wirt; Pfad, Abfrage und Anker bleiben. Und
  weil geparst und nicht ersetzt wird, bleibt ein alter Wirt, der in einer
  Abfrage steht (`?ziel=https://alt.example/x`), unangetastet - eine
  Textersetzung truege ihn mit um
- Nicht angefasst wird, was nicht dazugehoert: ein Vorschaubild auf einem
  fremden Server, ein eigenes Bild als Data-URL, ein Unterwirt wie
  `cdn.alt.example`, und die Eintraege aller anderen Anbieter. Steht ein
  zweiter Anbieter auf derselben alten Adresse, nennt die Rueckfrage ihn - er
  bleibt, wo er ist
- Strenger als sonst bei Adressen: ein Wirt ohne Punkt wird abgewiesen. Beim
  Anlegen eines Anbieters ist Grosszuegigkeit richtig, hier nicht - ein
  Vertipper zoege die ganze Watchlist auf einen Wirt, den es nicht gibt, und
  die alte Adresse waere danach nirgends mehr nachzuschlagen
- Die offene Anbieterseite wird gleich mit auf die neue Adresse gezogen, statt
  als tote Seite stehenzubleiben
- Ueber *Meine Geraete* wandert die neue Adresse nicht mit. Wer denselben
  Anbieter anderswo unter einer anderen Adresse erreicht, behaelt seine

**Relay**

- Ein Schluessel fasst jetzt zwanzigtausend Eintraege statt zweitausend. Die
  Titel sind wenige hundert; die Sitzungen treiben die Zahl, und sie verfallen
  nicht - ein Jahresrueckblick, der mit der Zeit schrumpft, waere keiner. Das
  reicht fuer ungefaehr ein Jahrzehnt taeglichen Schauens
- Zu sehen bekommt es davon so wenig wie bisher: eine Sitzung traegt den Titel
  der Folge, und sie ist verschlossen, bevor sie das Geraet verlaesst

## 1.31.0 — 21. August 2026

Laptop und Rechner haben ab jetzt denselben Stand. Ein Schluessel, kein Konto -
und das Relay kann nicht mitlesen.

**Meine Geraete**

- Neuer Punkt in den Einstellungen. Auf dem ersten Geraet einen Schluessel
  erzeugen, auf dem zweiten denselben eintragen - fertig. Was am Rechner
  geschaut wird, steht auf dem Laptop in *Weiterschauen* an derselben Stelle
- Nichts einzustellen und nichts beizutreten. Die Watchparty verbindet
  Menschen, und dort ist jeder Schritt eine Entscheidung: einstellen, beitreten,
  mitschauen. Zwischen den eigenen Geraeten gibt es nichts zu entscheiden - wer
  denselben Schluessel traegt, ist dieselbe Person
- Der Schluessel ist zugleich der Schalter. Ein zweiter daneben koennte nur
  einen Zustand herstellen, den niemand haben will: Schluessel eingetragen,
  Abgleich trotzdem aus
- Abgetipptes wird geradegezogen. Gross- und Kleinschreibung, Striche und
  Leerzeichen sind egal; `I` und `L` gelten als Eins, `O` als Null - genau die
  Verwechslungen, die beim Abschreiben vorkommen. Was danach nicht passt, wird
  abgewiesen: ein "fast richtig" gibt es hier nicht
- Es ist dasselbe Relay wie fuer die Watchparty. Eingeschaltet sein muss die
  dafuer nicht - die eigenen Geraete sollen zusammenbleiben, auch wenn gerade
  niemand mit anderen schaut

**Was mitgeht**

- Folge, Stelle, Fortschritt, abgeschlossene Titel und Folgen, Watchlist und
  die Reihenfolge in der Mediathek. Geloeschtes verschwindet ueberall - dafuer
  bleibt beim Relay ein Grabstein liegen, sonst holte das andere Geraet den
  Titel beim naechsten Abgleich zurueck
- Nicht mit gehen das eigene Titelbild und der Verlauf je Eintrag. Das Bild
  liegt als Data-URL vor und ist um ein Vielfaches groesser als alles andere
  zusammen; der Verlauf ist die Chronik eines Geraets. Was daran zaehlt, steht
  ohnehin im Stand
- Watchparty-Eintraege bleiben bei ihrem Raum. Dort werden sie abgeglichen, und
  zwei Wege fuer denselben Stand wuerden einander ueberholen
- Faellt etwas auseinander, gilt der neuere Stand - dieselbe Regel wie in der
  Watchparty. Gerechnet wird in der Zeit des Relays: zwei Rechner sind sich
  ueber die Uhrzeit selten einig, und ein Geraet mit falsch gestellter Uhr
  gewaenne sonst jeden Vergleich, fuer immer

**Was das Relay sieht**

- Nichts von dem, was dort steht. Aus dem Schluessel faellt eine Raumkennung
  (dort liegen die Eintraege), je Titel eine Eintragskennung (welcher Eintrag
  welcher ist) und eine Chiffre. Die ersten beiden gehen hinaus, die Chiffre
  nie - verschlossen wird mit AES-256-GCM, bevor etwas das Geraet verlaesst
- Die Eintragskennung ist ein HMAC, keine Pruefsumme: ohne den Schluessel laesst
  sich weder ein Titel zurueckrechnen noch eine Liste bekannter Titel
  durchprobieren. Sichtbar bleibt, wie viele Eintraege es gibt und wann sie
  sich aendern
- Das ist der Unterschied zur Watchparty, und er ist beabsichtigt: dort muss
  der Raum die Titel kennen, um sie anzuzeigen. Hier liest ohnehin nur der
  Besitzer
- Ein blosses Anmelden legt keinen Raum an. Ein vertippter Schluessel
  hinterlaesst damit nichts

**Der Kreis, der keiner werden durfte**

- Jedes Uebernehmen schreibt die Favoriten, und jedes Schreiben meldet den
  Stand hinaus. Merkt sich ein Geraet dabei das Empfangene statt das daraus
  Gewordene, schieben sich zwei Geraete denselben Eintrag ewig hin und her
- Das ist kein Sonderfall: die Adresse ist auf jedem Geraet eine andere, sobald
  ein Anbieter unter zwei Namen erreichbar ist - S.to laeuft hier ueber eine
  IP, dort ueber die Domain. Gemerkt wird deshalb, was hier gilt, nicht, was
  hereinkam
- Geprueft wird das ausgefuehrt, nicht gelesen: zwei echte Geraete an einer
  echten Verbindung, mit verschiedenen Adressen fuer denselben Titel. Nimmt man
  die Korrektur weg, faellt die Pruefung um

**Relay**

- Neue Datei `geraete.js`. Beim Aktualisieren muessen weiterhin alle
  `.js`-Dateien mit - `/health` weist den Abgleich unter `features` als
  `geraete` aus und zaehlt unter `geraeteRaeume`, wie viele Schluessel dort
  liegen
- Der Abgleich haengt an keinem Raumcode und steht deshalb vor der Raumpflicht:
  wer nur seine eigenen Geraete zusammenhaelt, soll keine Watchparty betreten
  muessen

## 1.30.0 — 21. August 2026

Ein Autoplay-Schalter im Bild, neben dem Chat. Und drei Stellen, an denen sich
etwas ausblenden liess, ohne dass es verschwand.

**Autoplay-Schalter**

- Links oben im Bild, neben dem Chat: ein kleiner Schalter fuer "Naechste Folge
  von selbst starten" - wie bei YouTube, an Ort und Stelle statt in den
  Einstellungen
- Es ist derselbe Schalter wie dort, nicht ein zweiter daneben. Er schreibt
  dieselbe Einstellung und gilt damit ueber die Folge hinaus. Was nur fuer die
  laufende Folge gilt, steht weiterhin am Ende in der Einblendung ("Danach
  aufhoeren") - zwei Dinge, die verschieden lange gelten, duerfen nicht gleich
  aussehen
- Er legt sich sofort um und meldet erst danach nach aussen. Die Einstellung
  liegt eine Prozessgrenze weiter; ein Schalter, der erst danach reagiert,
  fuehlt sich kaputt an
- Laeuft gerade ein Zaehler zur naechsten Folge, spuert er die Ansage sofort -
  nicht erst bei der uebernaechsten Folge
- Die Seitenleiste erfaehrt davon. Ohne diese Meldung stuende dort weiter der
  alte Stand, und das naechste Speichern von dort haette den Schalter aus dem
  Bild still wieder zurueckgedreht

**Eine Leiste fuer beides**

- Chat und Schalter teilen sich jetzt einen Kasten links oben, statt jeder fuer
  sich in derselben Ecke zu liegen. Der Schalter steht links und ist immer da;
  der Chat kommt und geht mit der Watchparty und haengt sich rechts daneben -
  so springt der Schalter nicht, wenn eine Runde beginnt oder endet
- Bleibt nichts uebrig, verschwindet auch die Leiste. Ein leerer Kasten ueber
  dem Bild finge sonst Klicks ab, die dem Player gehoeren

**Ausblenden, das wirklich ausblendet**

- Der Punkt "Rueckblick" stand in der Seitenleiste, auch wenn die Statistik
  abgeschaltet war. Der Code setzte die Klasse brav - nur hob sie das
  `display` der Grundregel nicht auf. Eine allgemeine Regel dafuer gibt es in
  dieser Datei bewusst nicht; jede haengt an ihrer Klasse, und diese fehlte
- Dieselbe Falle an zwei weiteren Stellen, gefunden beim Nachsehen: die
  Standzeile der Watchparty und die Jahresleiste auf der Statistikseite liessen
  sich ebenso wenig ausblenden
- Geprueft wird das jetzt fuer die ganze Oberflaeche auf einmal: jedes Element,
  das im Markup verborgen anfaengt, braucht eine Regel, die auf eine seiner
  Klassen passt. An dieser Stelle war ELFIX schon zweimal haengengeblieben -
  einmal bei "Live verlassen", einmal hier

## 1.29.0 — 21. August 2026

Der Player beim Hoster startet nicht mehr auf "Auto", sondern auf der hoechsten
angebotenen Stufe.

**Beste Bildstufe**

- VOE liess den Player auf "Auto" stehen. Auto waehlt nach Leitung und Puffer
  und liegt dabei gern eine Stufe unter dem, was moeglich waere - einmal nach
  unten geregelt, kommt es von selbst oft nicht wieder hoch
- Gewaehlt wird die hoechste echte Stufe: der Hoehe nach, sonst aus der
  Beschriftung ("1080p"), sonst nach Bitrate. "Auto" zaehlt dabei nicht mit -
  das ist keine Qualitaet, sondern der Verzicht auf die Wahl
- Gesetzt wird einmal je Folge, nicht dauernd. Wer waehrend des Schauens von
  Hand auf 720p geht, hat einen Grund dafuer; ein Skript, das ihn sofort wieder
  hochdreht, waere eine Bevormundung. Erst die naechste Folge faengt wieder oben
  an
- Gibt es nur eine Stufe, bleibt alles, wie es ist

**Wo es greift**

- Der Player sitzt im Rahmen des Hosters, nicht im Dokument von AniWorld.
  Deshalb geht das Skript in alle Rahmen und tut nur dort etwas, wo ein solcher
  Player wirklich liegt
- Am Hostnamen laesst sich das nicht festmachen - VOE wechselt seine Adressen
  staendig. Deshalb entscheidet der Player selbst: findet sich keiner mit einer
  Stufenliste, geschieht nichts
- Eingespielt wird beim Laden und im Fortschritts-Takt. Beim Laden steht der
  Rahmen des Hosters oft noch nicht, und ohne Manifest kennt sein Player noch
  keine Stufen

**Hinweis**

- Immer die hoechste Stufe heisst auch: mehr Daten und, auf einer schwachen
  Leitung, eher ein Nachladen als bei "Auto". Wer das nicht will, stellt die
  Stufe im Player von Hand zurueck - fuer die laufende Folge bleibt sie dann
  stehen

## 1.28.2 — 21. August 2026

Der Watchparty-Chat aus 1.28.0 hat nie funktioniert. Beim Absenden stuerzte
ELFIX ab, empfangene Zeilen kamen nie an. Ausserdem sitzt er jetzt links oben.

**Der Absturz**

- Beim Absenden einer Zeile beendete sich der Hauptprozess mit
  "watchparty.chatSenden is not a function". ELFIX spricht nicht mit einer
  einzelnen Watchparty, sondern mit der Fassade ueber alle Raeume - und die
  kannte kein chatSenden. Sie hat es jetzt
- Eine Chatzeile geht in jeden Raum, in dem dieser Titel mitlaeuft - wie Pause
  und Sprung auch. Wer dieselbe Folge in zwei Raeumen schaut, schreibt in beide.
  Laeuft der Titel in keinem Raum, geht nichts hinaus

**Der Rueckkanal**

- Empfangene Zeilen erreichten die Seite nie. Die Fassade bekam einen Weg nach
  oben uebergeben, las ihn aber nicht aus - jede eingehende Nachricht verfiel
  still. Auch das ist verbunden, und die Zeile traegt jetzt den Raum, aus dem
  sie kam

**Warum das durchging**

- Geprueft wurde der Sendeweg mit einem Textvergleich ueber den Quelltext. Der
  stand richtig da - nur fand der Aufruf am anderen Ende niemanden. Das sieht
  man einem Quelltext nicht an
- An dieser Stelle laeuft jetzt die echte Fassade an einer echten Verbindung:
  eine Zeile hinaus, eine Zeile herein. Nimmt man die Korrektur weg, faellt die
  Pruefung um

**Position**

- Der Chat sitzt links oben statt rechts unten und waechst von dort nach unten.
  Der Knopf steht an derselben Ecke wie die Kopfzeile des Feldes, das er
  ersetzt. Der Folgenknopf und die Hinweise liegen am rechten Rand - dort kamen
  sie sich in die Quere

## 1.28.1 — 21. August 2026

Zwei Nachbesserungen an 1.28.0: der Watchparty-Chat war eingebaut, aber nicht zu
sehen, und der Rueckblick stand ungefragt in der Seitenleiste.

**Chat erscheint jetzt wirklich**

- Der Merker fuer den Chat wurde nur beim Laden der Seite gesetzt. Zu diesem
  Zeitpunkt steht noch gar nicht fest, ob hier eine Watchparty laeuft - der
  Live-Zustand entsteht erst danach. Damit war der Merker praktisch immer leer
  und die Einblendung fiel aus
- Er haengt jetzt am selben Fortschritts-Takt wie die Steuerung der Watchparty,
  die dieses Problem seit jeher so loest. Wer erst nach dem Laden beitritt oder
  live schaltet, bekommt den Chat damit ebenfalls - und endet die Runde,
  verschwindet er wieder

**Rueckblick nur auf Wunsch**

- Die Statistik ist von Haus aus ausgeblendet und laesst sich unter Startseite
  einschalten. Wer sie sucht, findet sie; wer sie nie brauchte, hat den Punkt
  nicht mehr in der Seitenleiste
- Im Dezember erscheint sie trotzdem, solange der Jahresrueckblick verfuegbar
  ist. Dafuer gibt es einen eigenen Merker neben "faellig": "faellig" erlischt,
  sobald man Wrapped angesehen hat - haenge die Sichtbarkeit daran, verschwaende
  der Weg zum Archiv genau dann, wenn man ihn wiederfinden moechte

**Relay**

- `/health` weist den Chat unter "features" aus. Das README verspricht, dass
  dort steht, was die laufende Fassung kann - genau daran sieht man nach dem
  Kopieren, ob der Dienst die neue Datei wirklich benutzt. Fuer den Chat stand
  dort bisher nichts
- Die Alternative waere gewesen, versuchsweise eine Chatzeile durch einen Raum
  zu schicken. Das will man nicht: entweder ist niemand da und man weiss
  weiterhin nichts, oder es sitzt jemand darin und liest den Test mit

## 1.28.0 — 21. August 2026

ELFIX misst ab jetzt, wie lange wirklich geschaut wurde - und baut daraus eine
Statistik, einen Jahresrueckblick und einen Chat fuer die Watchparty.

**Wiedergabezeit**

- Die Messung gab es laengst: ein Takt in der Anbieterseite vergleicht die
  Position des Players mit der real vergangenen Zeit und zaehlt nur, was zu
  beidem passt. Pause bewegt die Position nicht, ein Sprung nach vorn bewegt
  sie zu weit, ein schlafender Rechner gar nicht. Benutzt wurde das bisher nur
  als Schwelle - der Wert selbst wurde weggeworfen. Jetzt wird er gespeichert
- Eine Folge mit 24 Minuten Laufzeit ergibt keine 24 Minuten Wiedergabe. Wer
  fuenf Minuten schaut, zehn pausiert, sieben weiterschaut, acht vorspringt und
  zwei zu Ende sieht, hat 14 Minuten geschaut - nicht 24
- Wiedergabesitzungen liegen in einer eigenen Datei und werden alle 30 Sekunden
  gesichert. Ein Absturz kostet hoechstens eine halbe Minute, nie eine Sitzung
- Aus dem bisherigen Verlauf wurde uebernommen, was sicher ableitbar ist:
  Folgen, Abschluesse, Tage. **Keine** Wiedergabezeit - aus "abgeschlossen"
  folgt keine Stundenzahl. Solche Saetze sind als rekonstruiert gekennzeichnet
  und ihre Zeit zaehlt nirgends mit

**Statistik**

- Neuer Punkt "Rueckblick" in der Seitenleiste: Folgen, abgeschlossene Titel,
  Schautage, laengste Strecke, staerkster Tag, Genres, Top-Titel
- Zeitraum waehlbar - 7 Tage, 30 Tage, dieser Monat, Kalenderjahre, gesamt
- Wo nichts gemessen wurde, steht nichts. Keine Karte mit "0 Stunden", wenn die
  Wahrheit "unbekannt" lautet - stattdessen der Hinweis, ab wann gemessen wird
- Laeuft ein Titel unter mehreren Genres, wird seine Zeit anteilig verteilt.
  Sonst zaehlte eine Stunde bei drei Genres als drei

**ELFIX Wrapped**

- Ein eigener Jahresrueckblick im Vollbild: bis zu 19 Bilder, eine Aussage je
  Bild, grosse Zahlen, Poster im Hintergrund
- Verfuegbar vom 1. Dezember bis 6. Januar. Er meldet sich dezent auf der
  Startseite - kein Fenster, das sich vor die App stellt - und ist danach
  jederzeit ueber das Archiv auf der Statistikseite erreichbar
- Jedes Bild kennt seine Bedingung: ohne Wiederholungen keine Rewatch-Seite,
  ohne gemessene Zeit keine Stundenseite, ohne Anime keine Anime-Seite
- Ein angefangenes Jahr sagt, ab wann es Daten gibt. Januar bis Juli erscheinen
  nicht als ausgewertet, wenn im August angefangen wurde
- Statistik und Wrapped rechnen an derselben Stelle. Zwei Rechenwege ergaeben
  irgendwann zwei verschiedene Folgenzahlen fuer dasselbe Jahr

**Watchparty-Chat**

- Ein paar Zeilen ueber dem Video. Das Relay kannte Raum, Mitglieder und
  Absender ohnehin - der Chat ist ein kleiner Aufsatz darauf
- Eingeklappt, bis man ihn aufmacht, und sichtbar nur, solange die Maus sich
  bewegt. Unter dem Zeiger und beim Tippen bleibt er stehen
- Gespeichert wird nichts, weder im Relay noch in der App. Wer nicht dabei war,
  hat es nicht gelesen
- Das Relay muss dafuer neu ausgerollt werden. Aeltere ELFIX-Fassungen stoeren
  sich nicht daran: sie senden nie eine solche Nachricht

**Nach der Folge**

- Neue Einstellung "Naechste Folge von selbst starten". Aus heisst: der Knopf
  steht weiter da, nur der Zaehler laeuft nicht. Abgeschaltet ist der
  Automatismus, nicht der Weg zur naechsten Folge
- Und in der Einblendung selbst ein "Danach aufhoeren" fuer genau diese eine
  Folge. Zuruecknehmen nimmt den Zaehler wieder auf

## 1.27.2 — 20. August 2026

ELFIX loeschte bei jedem Start die Einstellungen der Websites mit. Deshalb
stand der Ton ueberall wieder auf 100.

**Was die Seiten sich merken**

- Im localStorage jeder Seite liegt, was du dort eingestellt hast - bei jedem
  Player die Lautstaerke, bei YouTube Qualitaet und Untertitel. ELFIX raeumte
  ihn zusammen mit dem Cache weg. Das stellt nichts zurueck, es verstellt es:
  jede Seite fing wieder bei ihrem eigenen Standard an, also bei voller
  Lautstaerke. Der localStorage bleibt jetzt
- Cache, Service Worker und die Ablagen der Werbenetze werden weiter geraeumt -
  sie sind der Grund, warum ueberhaupt geloescht wird. Cookies ebenfalls
  unberuehrt, du bleibst eingeloggt
- Der Taktgeber, der zusaetzlich alle 15 Minuten loeschte - auch mitten im
  Film -, ist weg. Geloescht wird nur noch beim Start und bei "Alles neu
  laden", also genau das, was in der Einstellung steht

**YouTube**

- Beste verfuegbare Qualitaet und Untertitel aus, gesetzt beim Oeffnen eines
  Videos und bei jedem Videowechsel. Nur einmal je Video: wer Untertitel fuer
  eine Szene einschaltet oder bei schlechter Leitung heruntergeht, behaelt
  seine Wahl
- Wem YouTube als Anbieter fehlt, bekommt ihn einmalig nachgetragen. Erkannt
  wird ein vorhandener Eintrag an seiner Adresse, nicht am Namen. Einmalig
  heisst einmalig: wer ihn danach loescht, behaelt ihn geloescht
- Steht "YouTube-Videos in die Mediathek" an, hat die Mediathek jetzt zwei
  Reiter: "Serien & Filme" und "YouTube". Vorher liefen die Videos zwischen
  die Serien, und wer nachsehen wollte, was er durchhat, fand es nicht mehr.
  Ohne die Einstellung sieht die Mediathek aus wie zuvor

**Anbieter**

- Rechtsklick auf einen Anbieter in der Leiste fuehrt ueber "Bearbeiten"
  direkt zu seinen Einstellungen - Anbieterseite, er selbst ausgewaehlt,
  Formular ausgefuellt
- Rechts neben den Anbietern steht ein Plus, das einen neuen anlegt

## 1.27.1 — 20. August 2026

Der Verlauf in der Mediathek zaehlte das Oeffnen statt das Schauen, und die
YouTube-Watchparty ist jetzt auch in der App da.

**YouTube-Watchparty**

- Auf YouTube ist nicht ein Video die Runde, sondern die Sitzung: man klickt
  sich durch Empfehlungen, Suche und "Naechstes Video", und genau dieses
  Weiterklicken machen jetzt alle mit. Ein Videowechsel beendet die Runde
  also nicht, sondern zieht sie mit
- Einen Host gibt es nicht - jedes Mitglied darf anhalten, springen und
  weiterschalten
- Der eigene Raum wird oben in der Leiste gewaehlt: die Anzeige der Runde ist
  zugleich der Schalter zwischen "privat" und einem Raum. Sie erscheint nur
  auf YouTube-Seiten, und dort verschwindet dafuer der ⇄ Knopf der
  Serien-Watchparty. Der stellt einen Titel in einen Raum, und ein
  YouTube-Video ist keiner - nebeneinander waren es zwei Schalter fuer
  dasselbe, von denen einer das Falsche tat
- Eingerichtet wird sie ueber Server und Raeume der bestehenden Watchparty;
  ein eigener Bereich dafuer steht in der Watchparty-Ansicht

**Verlauf**

- "3 Mal geschaut an 2 Tagen" stand an einem Film, den ELFIX dreimal
  geoeffnet, aber nie beim Abschluss gesehen hatte. Die Zeilen hiessen
  "Film geöffnet" - das sagt nur, dass die Seite auf war
- Gezaehlt werden jetzt Abschluesse. Aufgelistet wird nur, was wirklich
  geschaut wurde: abgeschlossene Durchlaeufe und einzelne Folgen
- ELFIX haelt den Abschluss ab jetzt auch fest. Vorher gab es das Ereignis
  nur, wenn der Player ein echtes Ende meldete - bei einem Film, der ueber
  die 90 Prozent oder von Hand fertig wird, also nie. Vermerkt wird nur der
  Uebergang: wer einen fertigen Titel noch einmal oeffnet, erzeugt keinen
  zweiten Abschluss
- Fuer Titel aus der Zeit davor zaehlt der gespeicherte Abschlusszeitpunkt
  mit, damit dort nicht "null Mal abgeschlossen" steht
- Der Menuepunkt erscheint nur noch, wenn es mehr als den einen
  offensichtlichen Abschluss gibt - dessen Datum steht ohnehin auf der Karte

**Kleinigkeit**

- Im Verlaufs-Kasten stand ein "Abbrechen"-Knopf, obwohl es dort nichts
  abzubrechen gibt. Er war als versteckt markiert, aber in dieser Oberflaeche
  gibt es keine allgemeine Regel dafuer - jede haengt an ihrer Klasse

## 1.27.0 — 20. August 2026

Die Mediathek laesst sich sortieren und sagt, wann du etwas gesehen hast, ELFIX
meldet neue Folgen auch bei geschlossenem Fenster, und in einer Watchparty auf
YouTube zieht ein Videowechsel die Runde mit.

**Mediathek**

- Sortieren nach "Von Hand", "Zuletzt gesehen", "A-Z" und "Nach Anbieter".
  Keine dieser Ansichten schreibt die Reihenfolge - nur das Ziehen tut das,
  und Ziehen gibt es nur in "Von Hand". Eine selbst gelegte Reihenfolge
  ueberlebt also einen Ausflug nach A-Z unveraendert
- Jede Karte sagt, wann der Titel durch war
- Wer einen Titel mehrfach geschaut hat, findet unter den drei Punkten
  "Verlauf ansehen": wie oft, an wie vielen Tagen, und die Liste mit Datum
  und Folge. Gezaehlt werden Tage, nicht Folgen - zwanzig Folgen an einem
  Abend sind ein Abend
- Derselbe Titel stand doppelt da, wenn man ihn privat und in einer
  Watchparty geschaut hatte. Jeder Raum fuehrt seinen eigenen Fortschritt,
  das ist gewollt - aber in der Mediathek zaehlt das Werk, nicht der Raum.
  Uebrig bleibt der private Eintrag mit der laengeren Geschichte

**Benachrichtigungen**

- ELFIX meldet neue Folgen jetzt ueber Windows, auch wenn das Fenster zu ist.
  Erkannt wurden sie laengst - gesagt wurde es nur, solange man hinschaute,
  und genau dann braucht man es nicht
- Standardmaessig aus. Eine Meldung, die man nicht bestellt hat, ist eine
  Stoerung

**Watchparty auf YouTube**

- Klickte jemand ein neues Video an, ruehrten sich die anderen nicht. Bei
  Serien nimmt ein Folgenwechsel die Runde laengst mit - die Kette war also
  da und scheiterte an einer Stelle: der Serienschluessel wirft die Abfrage
  einer Adresse weg, und die YouTube-Videokennung steckt genau dort. Fuer die
  Watchparty sah damit jedes Video aus wie dasselbe
- Verglichen wird jetzt die Videokennung. Mitgezogen wird weiterhin nur, wer
  live geschaltet ist; die Startseite, ein Kanal oder Shorts loesen nichts aus
- Nebenbei behoben: eine Pause an einem YouTube-Video wurde bisher auch bei
  jemandem angewendet, der gerade ein ganz anderes schaute

## 1.26.0 — 20. August 2026

Ein neuer Werbefilter, der die AdGuard-Listen wirklich versteht, das
Vorbereitungsfenster bei S.to klickt sich selbst durch, und YouTube ist vom
geduldeten Sonderfall zum richtigen Anbieter geworden.

**Der Werbefilter blockt jetzt auch, was keine eigene Anfrage ist**

- Trotz eingeschaltetem Adblocker standen Fake-Gewinnspiele, Casino- und
  "Virus gefunden"-Einblendungen ueber dem Player. Die sind meist kein
  zweites Fenster, sondern ein paar DIVs, die ein laengst geladenes Skript
  in die Seite haengt - dagegen half kein Domainfilter
- Der bisherige Filter war ein Teilparser: er zog Domainnamen aus den
  AdGuard-Listen und warf den Rest weg. Typoptionen ($script, $third-party),
  Domaineinschraenkungen, Ausnahmen (@@) und jede kosmetische Regel (##)
  fielen unter den Tisch
- Neu laeuft @adguard/tsurlfilter, die Engine aus AdGuards eigener
  Browsererweiterung. Sie liest dieselben Listen, die ELFIX ohnehin holt,
  und versteht sie vollstaendig
- Listen: Base, Tracking Protection, Annoyances und neu German. Social Media
  faellt weg - Teilen-Knoepfe gibt es auf Streaming-Seiten kaum
- Die Selektoren der Listen werden je Rahmen als CSS eingespielt, im
  Hauptdokument wie im eingebetteten Hoster-Rahmen, nach jeder Navigation
  neu. Weil es CSS ist, greift es auch bei Elementen, die erst spaeter
  entstehen
- Fuer Overlays mit zufaelligen Klassennamen, die in keiner Liste stehen
  koennen, kommt eine eigene Erkennung dazu. Sie entscheidet nie nach
  Groesse allein: ohne Werbesignal - ein Ziel, das die Listen kennen, ein
  verraeterischer Text oder ein Werbename - bleibt alles stehen.
  Player-Bedienung, Captchas, Anmeldefenster und Cookie-Hinweise sind
  ausdruecklich geschuetzt
- Werberahmen koennen sich nicht mehr unbemerkt auf eine Gewinnspielseite
  schicken; der Hoster-Rahmen darf innerhalb seiner Seite weiter umleiten
- Der Hoster-Freibrief ist weg. Frueher hiess es "kommt es von VOE, ist es
  Wiedergabe" und die Anfrage lief komplett am Filter vorbei - genau
  darueber kamen die Popunder herein, denn die liegen auf denselben Hostern.
  Freigegeben wird jetzt nur noch, was ein Player wirklich laedt: Manifest,
  Segmente, Mediendatei und der eine Rahmen, mit dem der Anbieter den Hoster
  einbettet
- Geprueft an VOE, Filemoon, StreamWish, Dood, Vidmoly und Streamtape:
  Wiedergabe laeuft, Werbe- und Popunder-Skripte fallen trotzdem
- Das Protokoll trennt jetzt Netzregel, Skript, Tracker, Overlay, Popup,
  Haupt- und Rahmenumleitung sowie die Ausnahmen fuer Medien, Player und
  Verifizierung

**Das Vorbereitungsfenster bei S.to**

- S.to legt manchmal ein Fenster "Video wird vorbereitet..." vor den Stream,
  mit einer Cloudflare-Abfrage und einem Knopf "Weiter". Der Autostart
  wartete davor auf ein Video, das erst hinter diesem Knopf entsteht, und
  gab nach seinem Zeitfenster auf
- ELFIX bestaetigt das Fenster jetzt selbst, und zwar sofort - es wartet
  nicht darauf, dass Cloudflare fertig ist
- Geklickt wird ausschliesslich innerhalb eines Kastens, in dem eine echte
  Cloudflare-Abfrage steckt, und nur bei passender Knopfbeschriftung.
  "Schliessen", "Abbrechen" und Werbeknoepfe werden nie angefasst
- Oeffnet die Seite den Stream daraufhin in einem neuen Fenster, darf er
  ausnahmsweise in die laufende Ansicht laden - sonst haette der
  Popup-Schutz genau den Klick entwertet, den ELFIX gerade gemacht hat

**YouTube**

- YouTube ist bei einer Neuinstallation als vierter Anbieter dabei
- "Weiterschauen" setzt an der richtigen Sekunde fort statt am Anfang. Die
  Sekunde wird der Adresse mitgegeben, dadurch startet der Player von sich
  aus an der Stelle
- Dieselbe Adresse mit "list", "index", "pp" oder "si" ist nicht mehr ein
  eigener Titel mit eigenem Stand - alle Schreibweisen fuehren auf dasselbe
  Video
- Das Kartenbild ist das Vorschaubild des Videos. Vorher stand dort das Bild
  aus der Empfehlungsspalte, weil das laufende Video gar kein Bild ist,
  sondern ein Videoelement
- Vollbild macht den Player gross, nicht die ganze Seite. Der allgemeine
  Notfallweg zog auf YouTube das groesste iframe ins Vollbild, und das ist
  dort ein unsichtbarer Anmelde-Rahmen von accounts.google.com
- Shorts kommen nicht mehr in "Weiterschauen" - sie dauern Sekunden und
  laufen in einer Schleife. Bereits gespeicherte werden aussortiert
- Ein Video gilt ab 90 Prozent als durch und verschwindet aus
  "Weiterschauen". Faellt der Fortschritt wieder darunter, ist es auch
  wieder offen
- YouTube-Videos landen nicht mehr in der Mediathek. Wer sie dort haben
  will, schaltet das unter "Fortschritt in Weiterschauen" ein
- Angefangene YouTube-Videos stehen in einer eigenen Reihe auf der
  Startseite, getrennt von Serien und Filmen. Sie steht an der Stelle, an
  der bisher "Beliebte Anbieter" stand; die Anbieter bleiben ueber die
  Seitenleiste erreichbar

**Unter der Haube**

- Der Aufbau des Filters dauert rund vier Sekunden und laeuft nebenher.
  Bis er steht, filtert eine eingebaute Notfallliste weiter - ELFIX startet
  nie ungeschuetzt und wartet nie auf den Werbefilter
- Die Listen liegen als Text auf der Platte. Ohne Internet startet ELFIX mit
  dem letzten gueltigen Stand; nachgeladen wird nur, was aelter als eine
  Woche ist
- Der Filter braucht dauerhaft rund 480 MB Arbeitsspeicher im
  Hauptprozess - das ist der Preis dieser Engine

## 1.25.0 — 19. August 2026

Vier Einstellungen, die nichts bewirkt haben, ein Kalenderfilter nach Fassung
und eine Seitenleiste, die beim Kleinerziehen des Fensters verschwand.

**Das Kartenmenue am Vorschlag und am Suchtreffer**

- Ein Vorschlag auf der Startseite und ein Treffer in der Suche waren
  Sackgassen: vormerken ging nur ueber das Herz in der Suche, abhaken gar
  nicht - man musste den Titel dafuer erst beim Anbieter oeffnen
- Beide tragen jetzt dasselbe Menue wie eine Karte, mit "Auf die Watchlist"
  und "Als gesehen abhaken". Weil ein Vorschlag noch kein Eintrag ist, legt
  ihn beides erst an
- Der Knopf haengt nur dort, wo es auch etwas anzulegen gibt: ein Vorschlag,
  der bloss zur Suche des Anbieters fuehrt, wuerde sonst mit der Suchadresse
  auf der Watchlist landen
- Steht ein Titel schon auf der Watchlist, fehlt der Eintrag - gefragt wird
  beim Oeffnen des Menues und nicht beim Bauen der Karte

**Rechtsklick auf die Kachel**

- Der Knopf mit den drei Punkten ist klein und sitzt in einer Ecke. Die rechte
  Maustaste oeffnet jetzt dasselbe Menue, ueberall: Weiterschauen, Startseite,
  Watchlist, Mediathek, Vorschlaege, Suchtreffer
- Das Kaestchen haengt sich an den Knopf und nicht an den Zeiger. So steht es
  immer an derselben Stelle der Kachel, und das Nachfuehren beim Neuzeichnen
  greift unveraendert
- Der Rechtsklick oeffnet immer und schaltet nie - sonst waere das Menue beim
  zweiten Druck auf dieselbe Kachel zugeblieben
- Neben allen Kacheln bleibt das Menue des Systems stehen

**Die Seitenleiste beim Kleinerziehen**

Zwei Fehler, die zusammen so aussahen, als loese sich die Leiste auf.

- Niedriges Fenster: die Leiste schnitt unten einfach ab. Bei 620 Pixeln
  Fensterhoehe endete sie bei "Watchparty", und Anbieter, Einstellungen und
  Hilfe standen 334 Pixel unterhalb der Kante - erreichbar mit nichts. Jetzt
  scrollt sie, und ihre Abschnitte lassen sich nicht mehr zusammendruecken
- Schmales Fenster: unter 1180 Pixeln blendete eine Regel Zeichen und
  Beschriftung jedes Eintrags aus. Sie stammte aus der Zeit, als die Leiste
  dort auf 78 Pixel schrumpfte - heute behaelt sie bis 980 Pixel ihre vollen
  232. Zurueck blieben leere Streifen mit den Ueberschriften dazwischen. Genau
  so sah es aus
- Auf Zeichenbreite schrumpft die Leiste weiterhin ab 980 Pixeln. Dort bleiben
  die Zeichen stehen und nur die Beschriftungen weichen
- Dabei aufgefallen: auf 64 Pixeln passten das "E"-Zeichen und der Pfeil
  daneben nicht nebeneinander, das Zeichen stand angeschnitten am Rand. Der
  Pfeil weicht dort jetzt; ein- und ausklappen geht weiter ueber das Zeichen in
  der Kopfzeile der Startseite

**Kalender: Filter nach Fassung**

- Wer nur deutsche Synchronfassungen schaut, interessierte sich fuer den Rest
  der Woche gar nicht - alles stand gemischt untereinander. Ueber der Woche
  steht jetzt eine zweite Filterzeile
- "Alle Fassungen", danach die vorkommenden: deutsche Synchronfassung zuerst,
  dann die Untertitelfassungen, der Rest alphabetisch
- Gezaehlt wird innerhalb der schon gewaehlten Art, damit die Zahlen zu dem
  passen, was danach dasteht. Bei nur einer Fassung bleibt die Zeile leer
- Dafuer mussten die Anbieter erst dieselbe Sprache sprechen: AniWorld nennt
  die Fassung ueber die Flagge neben der Folge ("japanese-german"), S.to
  schreibt sie in seine Schnittstelle ("Ger-Sub"). Ohne Abgleich stuenden zwei
  Knoepfe fuer dieselbe Sache nebeneinander
- "Ger-Sub" wird zu "Deutsche Untertitel" und nicht zu "Japanisch, Deutsche
  Untertitel" - was der Ton ist, steht in den Daten nicht

**Vier Einstellungen, die nichts bewirkt haben**

- "Groesse der Anbieter-Kacheln" wirkte auf keine einzige Kachel. Die Masse
  standen an fuenf Stellen fest, auf der Startseite sogar als Inline-Stil, der
  ohnehin jede Regel schlaegt. Jetzt stehen sie an einer Stelle, und die Dichte
  rechnet relativ dazu
- Der Netflix-Stil gab den Watchlist-Karten 320 auf 250 Pixel, also liegend -
  und setzte in den Einstellungen gleichzeitig "Poster", hochkant. Der Regler
  zeigte "Poster", die Karten waren keine. Welche Form sie haben, entscheidet
  jetzt allein "Groesse der Watchlist-Karten"
- Poster ist die Werkseinstellung. Der Hauptprozess sagte hier "medium", die
  Oberflaeche "poster" - wer nie an den Einstellungen drehte, sah nie Poster
- In "Dichte & Groesse" leuchteten zwei Knoepfe gleichzeitig: der zur
  eingestellten Dichte und "Benutzerdef.". Beide hingen an demselben Feld, das
  auch die Layout-Voreinstellung traegt. Ob die Dichte von Hand gesetzt wurde,
  steht jetzt fuer sich

Neu: leistetest mit 15 Pruefungen, die beide Regeln der Seitenleiste
festhalten. Dazu 12 Faelle fuer den Rechtsklick und der Filter nach Fassung.
24 Suiten, alle bestanden.

## 1.24.1 — 19. August 2026

Ein Fehler aus 1.24.0 und das Kartenmenue, das dabei aufgefallen ist.

**Nichts liegt mehr hinter dem Bild**

- In 1.24.0 wurde das eigene Titelbild vom Hintergrund der Karte zu einer
  eigenen Ebene. Die lag ueber jedem Kind, das nicht selbst positioniert ist -
  als Hintergrund lag das Bild vorher automatisch unter allem
- Lautlos verschwunden waren dadurch: die Mitglieder-Zeile einer Watchparty,
  ihre Knoepfe "Verlassen", "Oeffnen" und "Entfernen", die Zeile mit dem Stand
  und die Begruendung unter einer Empfehlung
- Titel, Anbieter und Fortschrittsbalken blieben zufaellig sichtbar - deshalb
  sah eine Karte auf den ersten Blick richtig aus
- Behoben an der Wurzel statt Element fuer Element. Jedes kuenftige Kind ist
  damit automatisch mit abgedeckt
- Geprueft wird das nicht an Klassennamen: fuer jedes sichtbare Kind aller vier
  Kartenarten und des Banners fragt die Pruefung, was an der Stelle wirklich
  obenauf liegt

**Das Kartenmenue**

- Es lag in der Karte, und eine Karte schneidet alles ab, was ueber ihren Rand
  hinausragt. Sechs Eintraege brauchten 262 Pixel, eine gewoehnliche Karte ist
  220 hoch - der untere Teil war schlicht abgeschnitten
- Ausserdem trug jede Karte ihr eigenes: wer nacheinander auf drei Karten
  tippte, hatte drei offene Menues nebeneinander, und keines ging von selbst
  wieder zu
- Jetzt gibt es ein einziges Kaestchen, das unter seinen Knopf gestellt wird.
  Zu geht es bei einem Druck woanders hin, bei Escape, beim zweiten Druck auf
  denselben Knopf und wenn der Knopf aus dem Bild scrollt
- Listenzeilen statt fetter Pillen: sechs Eintraege brauchen 216 statt 262
  Pixel. Die Schrift kam vorher aus einem fest verdrahteten Rosa, das zu keiner
  Einstellung passte - jetzt kommt sie aus dem Theme
- Die Eintraege stehen in drei Gruppen, durch eine duenne Linie getrennt: was
  man mit dem Titel vorhat, wie er aussieht, was man wegnimmt. Das Wegnehmen
  steht unten - es ist das Seltenste und das, was man am ehesten aus Versehen
  trifft
- Jeder Eintrag traegt ein Symbol, alle als Schriftzeichen und keines farbig,
  damit die Spalte ruhig bleibt. Das Herz ist dasselbe wie in der Kopfleiste -
  hohl, solange ein Titel nicht vorgemerkt ist, voll wenn doch

Zwei Dinge, die dabei gemessen und nicht vermutet wurden: waehrend einer
Watchparty werden die Karten alle paar Sekunden neu gezeichnet - das Menue
haengt sich deshalb an den neuen Knopf derselben Karte um, statt zuzugehen. Und
ein Horcher auf "scroll" war schaedlich, weil beim Neuzeichnen die
Scrollposition einer Reihe auf Null springt und ihn feuerte.

32 Pruefungen am Menue selbst und 111 an der laufenden App. Die Symbole werden
gegen ein Zeichen gemessen, das es in keiner Schrift gibt - fehlt eines in der
Schrift des Systems, malt der Browser ein leeres Kaestchen, und im Quelltext
faellt das nie auf.

## 1.24.0 — 19. August 2026

Zwei Arbeitsstaende, die seit 1.23.0 liegengeblieben sind.

**Titelhintergrund: Bildausschnitt waehlen**

- Ein eigenes Titelbild wurde ueberall mittig gedeckt - auf dem breiten Banner
  der Startseite genauso wie auf den schmalen Karten. Bei einem Bild, dessen
  Logo oben sitzt, schnitt ELFIX genau das Logo weg
- Nach der Wahl eines Bildes - und ueber "Ausschnitt bearbeiten" auch spaeter
  noch - geht jetzt ein Editor auf. Die Vorschau darin ist keine nachgebaute
  Ansicht, sondern die echte Karte samt Titel, Anbieter, Fortschrittsbalken,
  Laufzeit und Abdunklung
- Vier Formen lassen sich einzeln einstellen und einzeln speichern: Poster
  (2:3), Mittel, Gross (16:9) und Banner. Jede haelt ihren eigenen Zoom und
  ihre eigene Lage; ein Zug im Poster laesst das Banner unberuehrt
- Verschoben wird mit Maus oder Finger direkt im Bild, gezoomt mit Regler,
  Mausrad oder zwei Fingern. Dazu "Zuruecksetzen", "Bild zentrieren",
  "Speichern", "Abbrechen" und "Uebernehmen"
- Gestreckt wird nie, und leere Flaechen kann es nicht geben: der Zoom faellt
  nie unter die Deckungsgroesse. Das gilt ohne Fallunterscheidung, in jeder
  Form und bei jeder Fenstergroesse
- Gespeichert wird getrennt vom Bild, am Titel, in Verhaeltnissen statt in
  Pixeln. Ein neuer Ausschnitt bewegt damit ein paar Zahlen und nicht ein paar
  hundert Kilobyte - dasselbe Bild wird nie zweimal abgelegt
- Aeltere Eintraege mit nur einer Lage werden auf alle vier Formen gelegt,
  damit sich am Bild nichts aendert
- Nebenbei laesst sich der Text auf Karten und im Banner nicht mehr markieren.
  Ein Zug ueber den Titel bewegt jetzt das Bild - das half auch beim
  Umsortieren in der Mediathek

**Externe Metadaten und bessere Empfehlungen**

- TMDB und AniList haengen jetzt am Watchparty-Relay statt an jedem Geraet
  einzeln, dazu ein Client in der App, der zuerst den eigenen Zwischenspeicher
  fragt und einen Treffer bei zu geringer Konfidenz nachprueft
- Der Kandidaten-Pool der Empfehlungen ist gerichtet: paginierte Genrelisten,
  kein Genre-Kollaps mehr, gleichmaessigeres Genre-Wissen ueber die Anbieter
  hinweg und Adressen nicht mehr nur aus der Saat
- Die sichtbare Begruendung kommt aus dem finalen Scoring, damit dort nicht ein
  Grund steht, der die Reihenfolge gar nicht bestimmt hat

79 Rechenpruefungen zum Ausschnitt und 94 an der laufenden App: alle vier
Formen, fuenf Bildformate von 3840x600 bis 600x3000, Ziehen mit echter Maus,
Mausrad, Regler, Anschlag - und ein Ende-zu-Ende-Lauf, der einen Ausschnitt
speichert und danach an den echten Karten und am Banner nachliest. Insgesamt
23 Suiten, davon vier gegen ein laufendes Relay.

## 1.23.0 — 19. August 2026

Empfehlungen: der Kandidaten-Pool war kaputt, nicht die Bewertung.

Die Genre-Uebersichten der Anbieter sind blaetterbar und alphabetisch
sortiert. Gelesen wurde nur Seite 1 - bei AniWorld eine von 36, bei S.to eine
von 60. Damit bestand das Angebot, aus dem ueberhaupt ausgewaehlt werden
konnte, dauerhaft aus dem Anfang des Alphabets: 46 Prozent aller Vorschlaege
begannen mit "A". Ein Limit beim Lesen einer Seite behebt das nicht - was nie
Kandidat war, kann nicht empfohlen werden.

**Vier Fehler, alle vor dem Ranking**

- Nur Seite 1 je Genre-Liste. Jetzt wird die Blaetterleiste ausgelesen und
  gleichmaessig ueber ihre ganze Laenge gelesen: statt 859 Rohtiteln aus 26
  Seiten sind es 4642 aus 136
- Die Kappung auf 900 Kandidaten ging nach blosser Profilpassung und liess den
  Pool auf das staerkste Genre zusammenfallen - 81 Prozent trugen "Abenteuer".
  Jetzt bekommt jedes Lieblingsgenre einen Anteil an den Plaetzen, der seinem
  Gewicht im Profil entspricht
- Die beiden Kandidatenquellen wurden mit ungleichem Wissen bewertet: ein
  Titel aus einer Genre-Liste kannte nur die Genres der Listen, in denen er
  zufaellig gefunden wurde. Jetzt bekommen die aussichtsreichsten Kandidaten
  ihre echten Genres von der Detailseite
- Genre-Adressen kamen nur aus den zwoelf Verlaufstiteln. Fiel der letzte
  Actionfilm aus dem Verlauf, war der Action-Katalog unerreichbar. Jetzt zaehlt
  jede je gelesene Detailseite als Adressquelle

Mit echten Daten nachgerechnet: A-Anteil 46 auf 13 Prozent, Kandidaten 416 auf
968. Bei einem Naruto-Verlauf steht Naruto Shippuden auf Platz 1, Hunter x
Hunter auf 3; bei Iron Man stehen Teil 2 und 3 in der Top 15.

**Die Anbieterseiten geben mehr her als Genres**

- Gelesen werden jetzt auch IMDB-Kennung, Altersfreigabe, Anfangs- und
  Endjahr, fremdsprachige Titel sowie Besetzung und Regie. Das war schon immer
  da und wurde nie gelesen
- Die IMDB-Kennung loest ein Werk eindeutig auf: kein Titelvergleich, keine
  Verwechslung zwischen zwei Verfilmungen desselben Stoffs
- Die Altersfreigabe trennt, was die Genres nicht trennen: Paw Patrol 0, Korra
  6, Naruto 12, One Piece 16. Fuer die Genres ist beides "Animation, Abenteuer"

**Metadaten-Tor im Watchparty-Relay**

- Der TMDB-Schluessel darf nicht auf die Geraete - alles, was in ein
  Electron-Bundle wandert, ist lesbar. Deshalb fragt die App nicht TMDB,
  sondern das Relay
- Vier Routen und eine Statusauskunft. Keine allgemeine Weiterleitung, kein
  durchgereichter Pfad, nach aussen nur eine Normalform statt roher
  Fremdantworten
- Mit Cache und Negativ-Cache, Zusammenlegung gleichzeitiger gleicher
  Anfragen, Taktbremse je Adresse, Zeitgrenzen und geprueftem Eingabeschema
- Belegte Beziehungen und fremde Empfehlungen bleiben getrennte Felder - eine
  TMDB-Empfehlung wird nie zu einer Fortsetzung
- Fehlt der Schluessel, laeuft alles weiter: Anime kommt von AniList, Filme und
  Serien bleiben ohne Anreicherung

Alte, abgeschnittene Listen werden beim Start automatisch verworfen - ohne das
haetten sie sechs Stunden ueberdauert. 17 Suiten, darunter drei neue: Katalog
(Blaetterleisten und Stichproben), Metadaten (die Angaben der Anbieterseiten)
und Gateway (52 Pruefungen mit gestellten Fremdantworten, bis hin zu
Ausbruchsversuchen aus dem Pfad und dem Nachweis, dass der Schluessel nirgends
auftaucht).

## 1.22.0 — 18. August 2026

Die Empfehlungen verstehen jetzt Filmreihen.

Bisher lief alles ueber ein einziges Signal: passt das Genre zum Profil? Wer
Teil 1 einer Reihe durchgeschaut hatte, bekam irgendeinen Actionfilm
vorgeschlagen - nur nicht Teil 2. Das Ranking hat jetzt mehrere Signale, und
das staerkste davon ist die Reihe.

**Reihen und Fortsetzungen**

- Aus dem Titel wird erkannt, was zusammengehoert: "John Wick: Kapitel 4",
  "Iron Man 2", "Harry Potter und die Kammer des Schreckens", "The Dark Knight
  Rises". Auch ueber Schreibweisen hinweg - roemische Zahlen, "Teil 2",
  "Chapter 3", "Vol. 2"
- Wer Teil 1 fertig hat, bekommt Teil 2 ganz oben. Wer Teil 2 fertig hat,
  Teil 3 - und Teil 2 nicht noch einmal
- Ohne Nummern gilt es als dieselbe Reihe, aber nicht als belegte
  Fortsetzung: dass "Die Kammer des Schreckens" nach "Der Stein der Weisen"
  kommt, steht nirgends in den Daten
- In der echten Ablage findet das Iron Man 1 bis 3, Avengers 1 bis 4,
  Dark Knight und Harry Potter zusammen

**Dubletten**

- Derselbe Film bei drei Anbietern ist eine Empfehlung, nicht drei. "Ger Dub"
  neben "Ger Sub" ebenfalls nicht. Die anderen Fassungen haengen als
  Alternativen daran
- Auch "Reacher Staffel 1 | SerienStream (S.to)" und "Reacher" fallen
  zusammen - Anbieter- und Staffelzusaetze gehoeren nicht zum Titel

**Was sonst noch zaehlt**

- Was gerade laeuft, wiegt schwerer als der Verlauf von vor Monaten - ohne
  dass der langfristige Geschmack wegfaellt
- Genres werden als Mengen verglichen, nicht einzeln: "Action+SciFi+Thriller"
  passt deutlich besser zu "Action+SciFi" als zu "Action+Comedy+Family"
- Die Watchlist zaehlt positiv, aber schwaecher als etwas, das wirklich
  geschaut wurde. Mehrere aehnliche Merkzettel verstaerken sich
- Mehrere kurze Abbrueche in dieselbe Richtung wirken vorsichtig negativ. Ein
  einzelner Abbruch bedeutet nichts
- Ein Titel, der oft gezeigt und nie geoeffnet wurde, sinkt langsam ab statt
  ewig oben zu stehen. Wird er doch geoeffnet, faengt die Zaehlung von vorn an
- Abgeschlossenes kommt nicht erneut

**Aufgeraeumt**

- Empfehlungen bleiben bei gleichem Profil gleich. Der Zufallswert, der
  bisher mit ins Ranking ging, ist weg - Erkundung laeuft ueber einen festen
  Wert je Titel
- Eine Reihe fuellt nicht mehr die ganze Startseite: nach dem naechsten Teil
  kommt etwas anderes
- Die alte Bewertung ist entfernt statt danebengestellt worden. Es gibt genau
  eine
- Mit ELFIX_EMPFEHLUNG_DEBUG=1 schreibt das System in die Konsole, woher die
  Punkte jedes Vorschlags kommen

Nicht umgesetzt, weil die Daten fehlen: Aehnlichkeit ueber Beschreibungen und
ueber Besetzung/Regie. ELFIX hat weder das eine noch das andere, und geraten
waere schlechter als weggelassen.

77 neue Pruefungen in zwei Suiten.

## 1.21.0 — 18. August 2026

Sicherung und Wiederherstellung.

Bisher gab es keinen Weg, den eigenen Stand mitzunehmen - man musste wissen,
welche Dateien im Datenordner die wichtigen sind. Unter "Daten & Updates" steht
jetzt ein eigener Abschnitt mit zwei Knoepfen.

- "Sicherung erstellen" schreibt eine einzelne Datei mit allem, was nicht von
  selbst wiederkommt: Einstellungen, Watchlist samt Weiterschauen-Staenden und
  eigenen Bildern, die Watchparty-Ablage und die eigenen Anbieter
- Die beiden Zwischenspeicher bleiben ausdruecklich draussen - Filterlisten und
  Geschmacksprofil sind zusammen groesser als alles andere und bauen sich von
  selbst wieder auf
- "Sicherung einlesen" zeigt vorher, was in der Datei steckt: von wann sie ist,
  wie viele Eintraege, wie viele davon mit Weiterschauen-Stand und eigenem
  Bild. Erst danach wird ersetzt
- Der bisherige Stand wird davor als Kopie in den Datenordner gelegt. Wer die
  falsche Datei erwischt hat, hat eine Rueckfahrkarte
- Eingelesen wird ueber denselben Weg wie beim Programmstart. Eine von Hand
  bearbeitete oder aeltere Sicherung laeuft damit durch dieselbe Pruefung wie
  sonst auch, statt ungeprueft hereinzukommen

Die Geraetekennung der Watchparty bleibt bewusst draussen:

- Sonst gaebe es nach dem Einlesen auf einem zweiten Rechner zwei Geraete mit
  derselben Kennung, und das Relay haelt sie fuer eines - Host-Wahl und Leiste
  waeren dahin
- Beim Einlesen gilt darum immer die Kennung des Rechners, auf dem eingelesen
  wird. Der Geraetename kommt dagegen mit, und daran erkennt das Relay ein
  wiederhergestelltes Geraet wieder und zieht seinen Stand um
- Wer also nach einer Neuinstallation einliest, steht in seinen Runden wieder
  da, wo er war

Dazu 26 Pruefungen, die vor allem festhalten, was NICHT mitkommen darf.

## 1.20.0 — 17. August 2026

Der Abgleich startet jetzt klug und laesst danach in Ruhe.

Mit 1.19.0 war der laufende Ausgleich weg - dafuer stieg jeder Client an der
Stelle ein, an der der Host beim Absenden stand, und lag damit von Anfang an
zurueck. Beides ist jetzt zusammengefuehrt.

**Der Start rechnet mit**

- Jedes Ereignis traegt Stelle, Zeitpunkt, Laufzustand, eine laufende Nummer
  und die Folge. Der Empfaenger rechnet daraus aus, wo die Quelle in dem
  Augenblick steht, in dem er wirklich einsteigt - nicht, wo sie beim
  Absenden stand
- Unmittelbar vor dem Start wird noch einmal nachgerechnet. Der Host hat
  waehrend des Puffems ja weitergeschaut; bei einer halben Sekunde Puffern
  wird entsprechend weiter vorn eingestiegen
- Der Host wartet dabei auf niemanden. Er drueckt und laeuft los
- Gerechnet wird in Serverzeit. Die App misst den Uhrversatz zum Relay nach
  dem Muster von NTP - fuenf Proben beim Verbinden, danach alle halbe Minute,
  und es zaehlt die schnellste. Ohne belastbare Messung wird bewusst gar
  nicht hochgerechnet: lieber eine halbe Sekunde zu frueh als die Differenz
  zweier Systemuhren als Videozeit verrechnet

**Danach passiert nichts mehr**

- Kein Tempo, keine kleinen Korrekturen, kein Nachregeln. Bis fuenf Sekunden
  Versatz wird der Player nicht angefasst, und das steht so auch im Log
- Gesprungen wird erst, wenn drei Messungen hintereinander darueber lagen -
  eine einzelne faellt schon dann aus dem Rahmen, wenn der Host gerade
  puffert. Danach fuenfzehn Sekunden Ruhe
- Waehrend gepuffert, gespult oder gestockt wird, gar nicht: da steht die
  Stelle, waehrend die Zeit laeuft. Danach wird neu bewertet

**Verspaetete Ereignisse kommen nicht mehr durch**

- Ein Play, das sich unterwegs mit einem neueren Pause ueberholt hat, wird
  abgewiesen - ebenso alles aus einer Folge, die nicht mehr laeuft, und
  Messungen von einem Host, der keiner mehr ist

**Aufgeraeumt**

- Die gesamte Sync-Logik liegt jetzt in einer Datei und gibt es nur einmal:
  die Skripte im Player werden aus demselben Quelltext gebaut, der geprueft
  wird. Zwei Fassungen, die auseinanderlaufen koennen, gibt es nicht mehr
- Nirgends im Player wird noch playbackRate gesetzt - ausser auf 1, wenn eine
  aeltere Fassung etwas stehengelassen hat. Eine Pruefung haelt das fest
- 64 neue Pruefungen in zwei Suiten, darunter das Zusammenspiel mit einem
  nachgebauten Video: gemeinsamer Start, Pause und Play, manueller Sprung,
  Puffern, ein bis vier Sekunden Drift, kuenstlich mehr als fuenf, und zehn
  Minuten Wiedergabe am Stueck

## 1.19.0 — 17. August 2026

Der Abgleich fasst die laufende Wiedergabe nicht mehr an.

Abgeglichen wird nur noch, was jemand tut: Play, Pause, Folgenwechsel,
absichtliches Spulen. Der Zeitversatz, der beim Schauen von allein entsteht,
bleibt stehen.

- Am Tempo wird gar nicht mehr gedreht. Bei VOE hat das die Tonhoehe hoerbar
  verzogen, und manche Player stellen die Rate von sich aus zurueck - worauf
  sofort die naechste Korrektur ansetzte
- Auch die seltenen Spruenge sind weg. Jedes Setzen der Stelle laesst den
  Hoster neu puffern, und das Puffern erzeugt genau den Versatz, den der
  Sprung beheben sollte
- Uebrig bleibt eine Notbremse: erst ab fuenf Sekunden Unterschied wird
  gesprungen, und hoechstens alle fuenfzehn Sekunden. Weniger sieht beim
  gemeinsamen Schauen niemand, fuenf schon - dann redet der eine ueber etwas,
  das der andere noch nicht gesehen hat
- Das Relay meldet die Host-Zeit entsprechend erst ab vier Sekunden und
  hoechstens alle fuenf Sekunden statt alle zwei. Ob daraus ein Sprung wird,
  entscheidet weiterhin der Player - nur er kennt seine Stelle in dem Moment,
  in dem er handelt

Pause, Weiter und Spulen sitzen unveraendert auf die Hundertstelsekunde - an
den Ereignissen selbst aendert sich nichts.

## 1.18.3 — 16. August 2026

Der Windows-Build lief noch immer nicht durch:
- In drei der vier Relay-Pruefungen stand noch der absolute Pfad aus meinem
  Arbeitsverzeichnis. Auf dem Bauserver gibt es das Laufwerk nicht, also
  stuerzten sie ab, bevor sie irgendetwas melden konnten - und weil der
  Laeufer nur die Ausgabe las, stand dort nur "FEHL" ohne Grund
- Alle Pruefungen finden das Relay jetzt ueber einen relativen Pfad

## 1.18.2 — 16. August 2026

Der Windows-Build lief nicht mehr durch:
- Mit 1.18.1 sind die Pruefungen in "npm test" gewandert. Vier davon starten
  ein echtes Relay - dessen Abhaengigkeit war auf dem Bauserver aber nie
  installiert, also schlugen sie dort fehl und der Installer wurde gar nicht
  erst gebaut
- Der Bauserver richtet das Relay jetzt mit ein
- Fehlt es trotzdem, werden diese vier Pruefungen uebersprungen statt
  fehlzuschlagen - mit einem deutlichen Hinweis, damit die Abdeckung nicht
  still wegfaellt

## 1.18.1 — 16. August 2026

Der Abgleich dreht nicht mehr am Ton:
- Bis zu einer Sekunde Unterschied bleibt jetzt einfach stehen. Das sieht
  niemand, und jede Korrektur ist hoerbar oder sichtbar - beides stoert mehr
  als der Versatz selbst
- Zwischen einer und zweieinhalb Sekunden wird noch angeglichen, aber
  hoechstens um zwei Prozent statt fuenf. Dazu bleibt die Tonhoehe erhalten,
  soweit der Player das kennt - ohne das klingt schon ein Prozent seltsam
- Angefangen wird ueber einer Sekunde, aufgehoert schon unter 0,7: dazwischen
  passiert nichts Neues, damit das Tempo nicht staendig wechselt
- Erst ueber zweieinhalb Sekunden wird gesprungen

Die Anzeige "X schaut gerade" flackerte:
- Der Kartenbau nahm den gebuchten Fortschritt, der Sekundentakt den
  Live-Stand - jeder Neuaufbau nahm die Zeile weg, der Takt setzte sie wieder
  ein. Beide fragen jetzt dieselbe Stelle, und der Takt frischt nur noch den
  Text auf, statt die Zeile anzuhaengen
- Eine leere Meldung loescht den Stand nicht mehr; ob jemand dabei ist,
  entscheidet allein das Alter der Meldung

Die Pruefungen liegen jetzt im Projekt:
- Acht Suiten mit 152 Pruefungen unter "tests/", darunter vier, die je ein
  frisches Relay starten und das Zusammenspiel zweier Geraete pruefen
- "npm test" faehrt sie mit; bisher pruefte es nur die Syntax und hat damit
  keinen der Fehler dieser Reihe gefunden
- Die echten Kalenderseiten beider Anbieter liegen als Testdaten dabei -
  aendert sich dort das Markup, schlagen die Pruefungen an

## 1.18.0 — 16. August 2026

Der Abgleich ruckelt nicht mehr alle paar Sekunden.

Bisher hat das Relay bei jeder kleinen Abweichung einen Sprung angeordnet, und
jedes Setzen der Stelle laesst den Hoster neu puffern - das Puffern erzeugte
prompt die naechste Abweichung. Die Regelung sitzt jetzt dort, wo der Player
ist, und das Relay meldet nur noch, wie spaet es beim Host ist:

- Unter einer halben Sekunde passiert nichts. Das sieht niemand
- Zwischen einer halben und zweieinhalb Sekunden wird ueber die
  Abspielgeschwindigkeit angeglichen, zwischen 0,95 und 1,05 je nach Abstand.
  Das faellt nicht auf, und es puffert nichts nach
- Erst unter einer viertel Sekunde geht es zurueck auf Normalgeschwindigkeit -
  diese Hysterese verhindert das staendige Hin und Her
- Ueber zweieinhalb Sekunden bleibt es beim Sprung, danach acht Sekunden Ruhe
- Der Host ist die Zeitquelle und wird nie nachgeregelt
- Pause, Weiter und bewusste Spruenge laufen unveraendert ueber den exakten
  Weg - nur der laufende Drift ist sanft

Dazu:
- Das Skript wirkt in dem Rahmen, in dem das Video wirklich haengt - bei VOE
  ist das der Rahmen des Hosters, nicht das Dokument von AniWorld. Kann ein
  Player die Geschwindigkeit nicht aendern, wird die Totzone groesser und nur
  noch selten gesprungen, statt wieder im Sekundentakt zu zappeln
- Waehrend gepuffert oder gesprungen wird, regelt nichts nach
- Ein Folgenwechsel setzt Tempo, Merker und Sperren zurueck
- Ein Bericht im Log, hoechstens alle fuenf Sekunden und nur bei echter
  Aktion: hostTime, clientTime, drift, action und rate

## 1.17.7 — 16. August 2026

Der Kalender laeuft fluessiger:
- Beim Ueberfahren wurde neben der Groesse auch die Helligkeit angepasst.
  Ein Helligkeitsfilter zwingt zum Neuzeichnen der ganzen Kachel samt Cover,
  und bei bis zu sechzig Kacheln nebeneinander laufen davon mehrere
  gleichzeitig. Jetzt bleibt es bei der Groesse - die schiebt die Grafikkarte,
  ohne neu zu zeichnen
- Was ausserhalb des Sichtfensters liegt, wird gar nicht erst gezeichnet
- Die Kachel unter dem Zeiger bekommt eine eigene Ebene, solange er darauf
  steht. Dauerhaft fuer alle waere teurer als das Problem
- Alles nur im Kalender: die uebrigen Ansichten sehen aus wie bisher

Die Fassungen stehen jetzt untereinander:
- Hintereinander mit Trennpunkten brach der Text mitten im Namen um. Jede
  Fassung ist eine eigene Zeile
- Ausgeschrieben statt abgekuerzt: "Japanisch, Deutsche Untertitel" statt
  "Japanisch, dt. Untertitel"

## 1.17.6 — 16. August 2026

Der Kalender zeigt jetzt eine Woche statt drei:
- S.to liefert ueber seine Schnittstelle knapp drei Wochen am Stueck - unter
  "Montag" standen deshalb gleich drei verschiedene Montage untereinander.
  Gezeigt wird jetzt heute und die sechs Tage danach
- An den Wochentagen steht das Datum: "Montag 17.08. (56)". Es kommt aus den
  Eintraegen selbst, damit Reiter und Karten darunter dasselbe zeigen

Eine Folge, ein Eintrag:
- Die Anbieter listen dieselbe Folge je Synchronfassung einmal - sie stand
  dadurch dreifach untereinander. Jetzt steht sie einmal da und traegt ihre
  Fassungen gemeinsam: "Deutsch · Japanisch, dt. Untertitel · Japanisch,
  engl. Untertitel". Deutsch zuerst, danach die Untertitelfassungen
- Bei AniWorld werden aus 172 Zeilen damit 91 Eintraege

Filter zwischen Animes und Serien:
- Ueber den Wochentagen steht "Alles / Animes / Serien" mit der jeweiligen
  Anzahl. Die Wahl bleibt beim Blaettern durch die Woche bestehen
- Die Art kommt aus der Adresse, nicht vom Anbieter - fuehrt einer beides,
  stimmt die Zuordnung trotzdem
- Angeboten wird die Zeile nur, wenn es wirklich beides gibt

## 1.17.5 — 16. August 2026

Ein Kalender, zwischen Suche und Watchlist:
- Zeigt, wann die naechsten Folgen bei deinen Anbietern erscheinen - nach
  Wochentagen, geoeffnet auf heute, mit der Anzahl je Tag
- Je Eintrag Cover, Titel, Anbieter, Staffel und Folge, Datum und Uhrzeit.
  Ein Klick oeffnet den Titel beim Anbieter
- Bei AniWorld steht dazu die Fassung: Deutsch, Japanisch mit deutschem oder
  mit englischem Untertitel. Dieselbe Folge steht deshalb mehrfach im
  Kalender - das sind keine Doppelten, sondern die Synchronfassungen. Wirklich
  Doppeltes, also gleiche Folge in gleicher Fassung, wird zusammengefasst
- Die beiden Anbieter bauen ihren Kalender verschieden: AniWorld liefert
  fertiges HTML, S.to laedt ihn per JavaScript nach und stellt die Daten unter
  einer Schnittstelle bereit. Probiert wird erst die Schnittstelle, dann die
  Seite - was zuerst etwas hergibt, gewinnt

Erscheinungsdatum in "Neu bei deinen Anbietern":
- Auf der Kachel steht jetzt, wann der Titel erschienen ist; liegt das Datum
  in der Zukunft, steht "Ab" davor
- Die Anbieter schreiben es in drei Formaten und an drei Stellen. Eine leere
  Angabe kommt dabei als "November 30, -0001" daher - alles vor 1900 wird
  verworfen, sonst stuende dort ein Datum aus dem Jahr null
- "Veroeffentlicht bei uns" bleibt aussen vor, das ist der Zeitpunkt des
  Uploads und nicht der Erscheinung

Ausserdem:
- In der Seitenleiste leuchteten Startseite und Kalender gleichzeitig: der
  neuen Ansicht fehlte ihre Zuordnung, damit galt fuer sie die Route der
  Startseite

## 1.17.4 — 16. August 2026

Die Watchlist nimmt jetzt den weitesten Stand:
- Denselben Titel gibt es mehrfach in der Ablage: den eigenen Eintrag und je
  einen pro Watchparty-Runde. Die Watchlist zeigte stur den eigenen - stand
  die Runde laengst bei Folge 3, hing die Watchlist weiter auf Folge 1
- Jetzt zaehlt je Titel der weiteste Stand: hoehere Staffel vor hoeherer
  Folge, bei gleicher Folge die weitere Stelle. Abgeschlossene Eintraege
  zaehlen nicht mit
- Zusammengehoerig ist, was auf dieselbe Serien-Adresse zeigt; fehlt die,
  entscheidet der Titel ohne Staffel- und Folgenangabe

## 1.17.3 — 16. August 2026

Host weitergeben, jetzt dort, wo man es sucht:
- Ein Knopf in der Kopfzeile neben "Sync". Er erscheint nur, wenn man den Takt
  selbst hat und ausser einem noch jemand mitschaut
- Ein Klick fragt, wer es werden soll - zur Wahl steht, wer gerade wirklich
  bei derselben Folge dabei ist, mitsamt Hinweis, wer davon pausiert hat
- Gefragt wird ueber ein Fenstermenue: ueber der Anbieterseite waere ein
  Kaestchen aus HTML nicht anklickbar
- In der Watchparty-Karte bleibt der Knopf je Mitglied bestehen

Die Kacheln auf der Startseite sprangen hin und her:
- Sortiert wird nach "zuletzt geschaut" - und eine Runde schreibt diese Zeit
  bei jeder fremden Meldung neu, also im Sekundentakt. Schauten zwei Leute
  gleichzeitig, tauschten ihre Kacheln staendig die Plaetze
- Fuer Eintraege einer Runde zaehlt jetzt, wann dieses Geraet zuletzt selbst
  dran war. Die Reihe steht damit still, waehrend die Inhalte weiterlaufen

## 1.17.2 — 16. August 2026

Die Karten in "Gemeinsam weiterschauen" zeigen jetzt, was gerade passiert:
- "Jakob schaut gerade" und der Stand kamen bisher allein aus dem gebuchten
  Fortschritt - also aus derselben Buchhaltung, die schon die Folgen haengen
  liess. Meist stand deshalb gar nichts da
- Die Live-Meldungen des Relays wurden ausserdem verworfen, sobald sie nicht
  zur gerade offenen Seite gehoerten. Fuer eine Karte traf das praktisch
  immer zu. Jetzt gehen sie fuer alle Titel durch; Kopfzeile und Player
  nehmen weiterhin nur die offene Seite
- Auf der Karte steht, wer laeuft und wer angehalten hat, dazu die Stelle und
  der Balken. Das eigene Geraet bleibt aussen vor
- Nachgezogen wird in Ort, nicht durch einen Neuaufbau: eine
  Sekundenaktualisierung der ganzen Startseite wuerde beim Scrollen springen
- Wer nichts mehr meldet, verschwindet nach zwanzig Sekunden aus dem Hinweis

Den Host weitergeben:
- In der Watchparty-Karte steht neben jedem anderen Mitglied ein Knopf dafuer
  - sichtbar nur, wenn man selbst Host ist
- Das Relay prueft es noch einmal: nur der aktuelle Host darf, und nur an
  jemanden, der bei derselben Folge wirklich mitschaut
- Umgesetzt im bestehenden Modell statt daneben: Host ist, wer die Folge
  zuerst betreten hat, also wird der Beschenkte vorgereiht

## 1.17.1 — 16. August 2026

Wer die Folge nicht mehr offen hat, ist sofort raus:
- Bisher wurde ein Geraet einfach still und verschwand erst, wenn sein
  Herzschlag fuenfzehn Sekunden alt war. So lange stand oben noch jemand, der
  laengst die Startseite anschaute
- Jetzt meldet sich das Geraet ausdruecklich ab. Das gilt fuer Startseite,
  Watchlist, Mediathek, Verlauf, Einstellungen, geschlossene Anbieterseite,
  eine andere Serie und das Umschalten auf privat
- Der Herzschlag schweigt ausserdem, solange eine eigene Ansicht ueber der
  Anbieterseite liegt. Vorher lief er weiter, weil die Seite dahinter am Leben
  bleibt - man stand also in der Leiste, waehrend man die Startseite ansah
- Der Ablauf nach fuenfzehn Sekunden bleibt als Netz fuer Absturz, Netzausfall
  und geschlossenes Fenster

Die Mitschauenden stehen jetzt auch im Player:
- Oben im Bild, sichtbar bei Mausbewegung, Klick oder Tastendruck, und nach
  gut zwei Sekunden Ruhe wieder weg - wie die Bedienleiste des Players
- Je Geraet Name, Zeichen fuer laeuft oder haelt an, die Sekunde und die
  Marke fuer den Host
- Allein in der Runde bleibt sie leer und damit unsichtbar
- Sie wird in den Rahmen eingespritzt, der das Video fuehrt: die
  Anbieterseite liegt ueber der Oberflaeche, ein Element der App waere dort
  nie zu sehen. Dadurch geht sie auch ins Vollbild mit - dort ist genau
  dieser Rahmen der Vollbild-Rahmen

## 1.17.0 — 16. August 2026

Der Host gehoert jetzt zur Folge, nicht zum Raum. Das war die Ursache dafuer,
dass oben "Host: Jakob" stehen blieb, obwohl Jakob laengst eine Folge weiter
oder gar nicht mehr am Player war - und niemand konnte sich an ihm ausrichten.

Die alte Logik ist entfernt, nicht ueberlagert: raumweite Beitritts-
Reihenfolge, gespeicherter Host, hostSicherstellen. An ihrer Stelle steht eine
Ableitung aus lebenden Meldungen:
- Aktiv ist, wer verbunden ist, Mitglied ist, dieselbe Staffel und Folge offen
  hat, eine laufende Player-Sitzung meldet und dessen Herzschlag keine 15
  Sekunden alt ist
- Host ist unter diesen der, der die Folge zuerst betreten hat
- Die Player-Sitzung wechselt bei jeder Navigation. Ein alter Player kann
  damit nicht weiter als aktiv gelten
- Weil der Host je Folge gilt, werden Raumzustand und Leiste je Empfaenger
  gebaut: jeder sieht den Host seiner eigenen Folge
- Wechselt der Host die Folge, verliert er den Host der alten. Kommt er
  spaeter zurueck, wird er dort nur Teilnehmer

Kein Host, wenn niemand mehr am Player ist:
- In der Uebersicht stand an jeder Karte ein Host, auch wenn dort seit Stunden
  niemand schaute. Jetzt bleibt in dem Fall nur der zuletzt bekannte Stand,
  und die Leiste ist leer statt voller Karteileichen

Wer pausiert hat, getrennt davon, wer pausiert ist:
- Das Relay fuehrt die letzte Aktion samt Ausloeser. Zieht ein zweites Geraet
  die Pause nur mit, bleibt der Ausloeser derselbe - vorher haette dort
  ploetzlich der Mitzieher gestanden
- Die Kopfzeile zeigt "Pausiert von Elias", solange die Runde steht
- Die Anzeige greift nur noch auf den bestaetigten Stand zurueck. Ein
  Zwischenruf ("X hat pausiert") ueberschreibt den Hostnamen nicht mehr

Spulen und Auseinanderlaufen:
- Der Echo-Schutz sah beim Sprung nur auf die Art des Ereignisses. Wer zweimal
  schnell hintereinander spulte, dessen zweiter Sprung kam bei niemandem an -
  er galt als Echo des ersten. Jetzt entscheidet die Stelle
- Hoster springen auf das naechste Schluesselbild, und das liegt bei jedem
  woanders. Weicht ein Geraet beim Schauen um mehr als 1,2 Sekunden vom Host
  ab, bekommt genau es einen Sprung auf dessen Stelle. Danach bleibt es sechs
  Sekunden ruhig: enger waere Zappeln, weil jeder Sprung den Hoster neu
  puffern laesst
- Der Host wird dabei nie gerueckt, und pausierte Geraete bleiben unangetastet

Befehle bleiben in ihrer Folge:
- Pause, Weiter und Sprung gingen an alle Mitglieder des Raums, auch an die
  mit einer ganz anderen Folge. Nur der Client filterte das weg - der
  Raumzustand war trotzdem verfaelscht. Jetzt filtert das Relay, und nur wer
  bei der Folge der Runde steht, bewegt deren Zustand
- Ein Folgenwechsel ist ausgenommen: der muss gerade die erreichen, die noch
  bei der alten Folge stehen

Der Raum folgte der Folge des Hosts nur ueber den Wechsel-Befehl:
- Die Pruefung dafuer fragte, wer *jetzt* Host ist - da stand das Geraet aber
  schon auf der neuen Folge und zaehlte fuer die alte nicht mehr mit. Die
  Bedingung konnte nie wahr werden. Blieb der Wechsel-Befehl aus, hing die
  Runde fest
- Massgeblich ist jetzt, wer die Runde vor dieser Meldung gefuehrt hat

Geprueft mit 78 Pruefungen gegen das laufende Relay: Host je Folge, die zwoelf
Ablaeufe einer Watchparty, Abgleich und Steuerung, Spulen und Ausgleich.

## 1.16.4 — 16. August 2026

Die Leiste sagt jetzt auf einen Blick, was los ist:
- Statt zweier Grautoene ein Zeichen samt Farbe - gruen fuer laeuft, gelb fuer
  angehalten. Beides zusammen, damit es auch dann eindeutig bleibt, wenn eine
  Schrift das Zeichen nicht kennt
- Wer den Takt vorgibt, traegt eine eigene Marke "Host". Vorher war er nur
  etwas fetter als die anderen und kaum zu erkennen
- Es steht nur noch da, wer diese Serie gerade wirklich offen hat. Jedes
  Geraet meldet sich alle paar Sekunden, auch pausiert; bleibt das aus,
  schaut dort jemand etwas anderes oder ist auf privat umgestellt

Der Fortschritt im Raum gehoerte noch zur Folge davor:
- Die Karte zeigte "Staffel 1 Folge 2" und daneben acht Minuten, die es in
  dieser Folge nie gab - der gebuchte Stand stammte aus Folge 1
- Beim Folgenwechsel faengt der Stand jetzt bei der neuen Folge an, egal ob
  der Wechsel ueber die Adresse oder ueber die Meldung des Hosts hereinkommt.
  Vorher wirkte das nur auf einem der beiden Wege

Vollbild ging bei allen verloren, die nichts gedrueckt hatten:
- Der Merker fuers Vollbild wurde erst nach der Navigation gelesen - und die
  verlaesst das Vollbild und setzt ihn vorher zurueck. Wer selbst
  weiterschaltete, blieb drin; wer nur mitgezogen wurde, fiel heraus
- Jetzt wird vor dem Wechsel gemerkt, was war

Filme bei Filmo starteten nicht:
- Vor dem Player steht dort "Tippe auf Play, um die Wiedergabe zu starten" -
  erst dieser Klick holt den Hoster herein. Der Autostart brach aber ab,
  sobald irgendein Rahmen im Dokument lag, und die Seite bringt einen mit.
  Der Klick-Teil wurde nie erreicht, also blieben Wiedergabe und Vollbild aus
- Die Suche nach dem Startknopf steht jetzt vor dieser Pruefung. Sie nimmt
  auch einen Knopf ohne Beschriftung, wie den runden Play-Knopf, und laesst
  Trailer, Anmeldung, Hoster-Auswahl und Beschreibung in Ruhe

Ausserdem:
- Sind die Anbieterseiten zu, wird aufgeraeumt: Cache, Service Worker und die
  lokalen Ablagen der Werbenetze. Anmeldungen bleiben, Cookies fasst das
  nicht an
- "X schaut gerade" stand zwei Minuten nach der letzten Meldung noch da.
  Jetzt sind es 25 Sekunden, und die Karte zeichnet sich genau zum Ablauf
  neu - vorher blieb der Hinweis stehen, bis zufaellig etwas anderes die
  Ansicht erneuerte, und genau das passiert nicht mehr, sobald der andere
  aufhoert
- Ein selbst gewaehltes Bild hat auch im Watchparty-Tab Vorrang. Dort gewann
  bisher das Bild aus dem Raum. Ans Relay weitergereicht wird weiterhin nur
  ein echtes Anbieterbild

## 1.16.3 — 16. August 2026

Nach einem Folgenwechsel riss die Watchparty ab. Dahinter stand kein toter
Player, sondern ein Kreis, aus dem niemand herauskam:

    Raum kennt neue Folge <- Fortschritt gemeldet <- Eintrag auf neuer Folge
                          <- Raum kennt neue Folge

Der eigene Eintrag rueckte erst nach zweieinhalb Minuten auf die neue Folge -
es sei denn, die Runde fuehrte sie schon. Und die Runde erfuhr davon nur aus
dem gemeldeten Fortschritt, der genau an diesem Eintrag haengt. Also blieb
alles auf der Folge davor stehen:
- Die Karte zeigte weiter "Staffel 1 Folge 1", obwohl laengst Folge 2 lief
- Pause und Weiter kamen beim anderen nicht mehr an: die Befehle trugen keine
  Adresse, also entschied der Raumzustand, ob es dieselbe Folge ist - und der
  stand auf der alten. Jede Pause fiel durch diese Pruefung

Behoben an den Ursachen, nicht an den Symptomen:
- Jeder Steuerbefehl traegt jetzt die Adresse seines Absenders. Der Empfaenger
  prueft damit gegen dessen Folge statt gegen den Raumzustand
- Die Runde folgt der Folge des Hosts, sobald sein Player sie meldet. Das ging
  ohnehin schon jede Sekunde hinaus - jetzt zieht der Raum daran nach, ohne
  Umweg ueber den gebuchten Fortschritt
- In einer Watchparty rueckt ein Eintrag nach 30 Sekunden auf die neue Folge
  statt nach zweieinhalb Minuten. Ausserhalb einer Runde bleibt es bei den
  bisherigen 2:30
- Die alte Abhaengigkeit vom gebuchten Fortschritt ist aus dem Steuerpfad
  entfernt, nicht ergaenzt

Host-Wahl nach Beitritts-Reihenfolge:
- Wer zuerst dabei war, ist Host, und solange er verbunden ist, aendert sich
  daran nichts. Faellt er weg, uebernimmt der naechste nach Beitritt
- Diese Reihenfolge fuehrt jetzt das Relay. Vorher entschied die Reihenfolge
  der Socket-Verbindungen - also wer zuletzt verbunden hat. Nach einem
  Reconnect stand der Erste damit ploetzlich hinten
- Dasselbe Geraet mit neuer Kennung behaelt seinen Platz, statt ans Ende zu
  rutschen
- Kommt ein abgemeldeter Host zurueck, bleibt der neue Host Host. Sonst
  spraenge die Rolle bei jeder wackligen Leitung hin und her

## 1.16.2 — 16. August 2026

Zwei Uhren, ein Fehler - an zwei Stellen:
- Die App rechnete `Date.now()` des eigenen Rechners gegen den Zeitstempel des
  Relays. Jede Abweichung zwischen beiden Uhren ging unbesehen ins Ergebnis:
  in der Leiste stand "2:25", waehrend der Player bei 1:48 lief, und beim
  Eintreffen einer Meldung sprang die Anzeige
- Dieselbe Rechnung steckte im Abgleich - dort landete die Differenz direkt in
  der Sprungstelle. Das war der Versatz nach vorn
- Das Relay rechnet das Alter jetzt selbst und schickt eine fertige
  Sekundenzahl; sein roher Zeitstempel geht gar nicht mehr hinaus. Beim
  Abgleich faellt der Zuschlag ersatzlos weg: das Relay verschickt sofort,
  nachdem es die Stelle bestimmt hat, uebrig bleibt reine Leitungszeit

Pause und Weiter wirken jetzt jedes Mal:
- Die Horcher hingen an den Video-Elementen, die beim Einhaengen zufaellig da
  waren. Tauscht die Seite den Player aus - anderer Hoster, andere Qualitaet,
  neu geladener Rahmen -, sassen sie an einem Element, das niemand mehr sieht.
  Der Merker stand auf "schon eingehaengt", also wurde nie nachgebessert, und
  das Geraet meldete Pause und Weiter ueberhaupt nicht mehr
- Sie haengen jetzt am Dokument in der Abfangphase und gelten damit auch fuer
  ein Video, das die Seite spaeter einsetzt
- Ausserdem stehen sie schon beim Laden der Seite statt erst im
  Fortschritts-Takt: das erste Play einer frischen Folge ging vorher unter

Bei jeder Pause stehen alle auf der Stelle des Hosts:
- Zuerst haelt jeder sofort an, egal wer gedrueckt hat - ohne das liefe man
  waehrend der Rueckfrage weiter. Danach meldet der Player des Hosts seine
  echte Stelle, und alle anderen ruecken exakt dorthin
- Die Toleranz liegt dafuer bei 50 statt 300 Millisekunden. Beim blossen
  Mitlaufen bleibt sie grob, sonst puffert der Hoster staendig neu
- Ausgerichtet wird einmal je Pause, nicht bei jedem Herzschlag

Der Host springt nie:
- Er bekommt Pause und Weiter weiter mit, damit er waehrend eines Abgleichs
  nicht davonlaeuft - aber keinen Sprungbefehl mehr. Alle richten sich nach
  ihm, nicht umgekehrt
- Damit das stimmt, nimmt das Relay als Ziel die Meldung aus seinem Player
  statt einer Hochrechnung aus der letzten Steuerung

Folgenwechsel lief in eine Pause:
- Beim Wechsel stand der Raum auf "pausiert bei 0". Jedes Geraet, das die neue
  Folge oeffnet, fragt den Stand ab - und bekam prompt eine Pause zurueck. Die
  Folge startete, lud und blieb stehen
- Eine neue Folge ist jetzt weder angehalten noch laufend: der Autostart
  laeuft durch, und das erste echte Play gibt den Takt vor

Ausserdem:
- Bleibt ein Geraet stehen, waehrend die Runde laeuft, reicht das Relay ihm
  gezielt ein Play nach - nur ihm, nur bei derselben Folge, hoechstens alle
  drei Sekunden
- Der Stand kommt nicht mehr aus einem Zeitgeber, der die ganze Seite
  abfragt, sondern die Seite meldet von selbst: sofort bei Pause, Weiter,
  Sprung und Puffern, waehrend der Wiedergabe nebenher im Sekundentakt. Der
  Zeitgeber bleibt als Rueckfallebene fuer Seiten, auf denen sich das Skript
  nicht einhaengen konnte
- Im Relay gehen Zustandswechsel ungedrosselt hinaus; nur reine
  Stellenmeldungen werden gebuendelt

## 1.16.1 — 16. August 2026

Die Zeit in der Leiste stimmt jetzt:
- Die Leiste hing an der Fortschritts-Buchhaltung - alle fuenf Sekunden, und
  nur wenn der aktive Eintrag zur Runde gehoert. Nach einem Folgenwechsel
  greift die nicht mehr: dann stand bei allen Geraeten dieselbe Sekunde aus
  der letzten Rundsendung und lief nur noch oertlich weiter. Dass hier
  pausiert war, wusste das Relay gar nicht
- Jedes Geraet meldet jetzt alle zwei Sekunden unmittelbar aus dem Player, wo
  es steht und ob es angehalten ist. Das Relay verteilt es an die Runde,
  hoechstens einmal pro Sekunde gebuendelt
- Wer bei einer anderen Folge steht, zeigt "S1E4" statt einer Sekunde. Ein
  Sekundenvergleich ueber Folgen hinweg sagt nichts, und vorher galt so
  jemand faelschlich als jemand, der hinterherhaengt

Nach einem Folgenwechsel blieb die Watchparty auf der alten Folge:
- Beim Wechsel wurde im Raum nur die Adresse gesetzt. Staffel und Folge zog
  allein der Fortschritt nach - und der kam nach dem Wechsel nicht mehr an.
  In der Karte stand deshalb weiter "Folge 1", obwohl laengst Folge 2 lief
- Das Relay liest die Folge jetzt aus der Adresse und meldet den neuen Stand
  sofort an alle

## 1.16.0 — 16. August 2026

Eine Leiste zeigt, wo die anderen stehen:
- In der Kopfzeile steht je Geraet ein Feld mit Name, Sekunde und einem Punkt
  fuer laeuft oder pausiert. Der Host steht fett, das eigene Geraet heisst
  "Du". Wer mehr als zwei Sekunden vom Host abweicht, wird gelb - dann lohnt
  ein Sync
- Zwischen zwei Meldungen laufen die Uhren in der Anzeige weiter, sonst
  haengt sie sichtbar hinter dem Bild her
- Sie sitzt in der Kopfzeile, weil die Anbieterseite ueber der Oberflaeche
  liegt: ein Streifen darunter waere ausgerechnet beim Schauen verdeckt
- Das Relay fuehrt dafuer je Geraet Stelle und Pausenzustand. Beides ist
  fluechtig - nach einem Neustart des Dienstes melden es die Geraete binnen
  Sekunden von selbst. Ein aelteres Relay schickt es nicht, dann bleibt die
  Leiste leer und alles andere laeuft unveraendert

Pausieren ging nach einem Sync manchmal ins Leere:
- Nach einer fremden Anweisung schwieg das Geraet ein paar Sekunden lang
  ganz, damit sich zwei Player nicht gegenseitig aufschaukeln. In 1.15.0 war
  dieses Fenster fuer das Puffer-Warten auf vier Sekunden gewachsen - wer
  darin Pause drueckte, pausierte nur bei sich
- Jetzt wird gezielt nur das Echo verschluckt: kam ein Play herein, gilt ein
  Play vom eigenen Player als Echo. Ein Pause ist die Gegenrichtung, also
  eine echte Tat, und geht sofort an alle

Der Abgleich sprang zu weit:
- Der Host meldet seine Stelle nur, wenn er drueckt. Laeuft er lange durch,
  ist dieser Wert Minuten alt, und das Relay rechnet von dort hoch, als waere
  lueckenlos abgespielt worden - jedes Puffern schob das Ziel nach vorn
- Der Fortschritt kommt alle paar Sekunden frisch aus dem Player. Massgeblich
  ist jetzt die juengere der beiden Meldungen

Eigene Bilder gelten ueberall:
- Denselben Titel gibt es mehrfach in der Ablage: den eigenen Eintrag und je
  einen pro Watchparty-Runde. Ein eigenes Bild klebte bisher an genau der
  Kachel, auf der es gesetzt wurde - in "Gemeinsam weiterschauen" stand
  weiter das Bild des Anbieters
- Setzen und Entfernen gelten jetzt fuer alle Eintraege desselben Titels, und
  ein neu entstehender Raum-Eintrag uebernimmt ein vorhandenes Bild
- Schon gesetzte Bilder werden beim ersten Start einmalig nachgezogen; von
  Hand noch einmal auswaehlen muss man nichts

Startseite:
- Aus "Weiterschauen" liess sich ein Titel nur im Weiterschauen-Tab
  entfernen. Die Kacheln auf der Startseite koennen es jetzt auch - in beiden
  Reihen, der eigenen und der gemeinsamen

## 1.15.0 — 16. August 2026

Popups bleiben weg, auch ohne eigenen Adblocker:
- Der haeufigste "Popup" auf diesen Seiten ist gar kein zweites Fenster: ein
  Werbeskript schiebt die ganze Ansicht auf eine Werbeseite, und mitten im
  Schauen ist die Folge weg. Das hing bisher an den Filterlisten - ohne
  geladene Listen kam es immer durch. Jetzt zaehlt nicht mehr, ob eine
  Adresse bekannt boese ist, sondern ob sie ueberhaupt hierher gehoert:
  Anbieter, bekannte Hoster, Verifizierung, Anmeldung, Ausnahmeliste - sonst
  nichts
- Ein neues Fenster geht nur noch fuer eine echte Abfrage auf. Vorher genuegte
  "video", "stream" oder "player" irgendwo in der Adresse, und weil ein
  erlaubtes Fenster in der laufenden Ansicht geoeffnet wird, landete man
  mitten im Schauen auf einer Werbeseite
- Die eingebaute Liste deckt jetzt 57 statt 23 Domains ab, vor allem die
  Popunder-Netze. Sie gilt immer, auch wenn kein Download klappt
- Fehlende oder ueber eine Woche alte Filterlisten werden beim Start
  nachgeholt, ueber den Netzwerk-Stack von Chromium. Eine hakende Liste
  reisst die anderen drei nicht mehr mit
- Serverseitige Weiterleitungen werden bewusst milder geprueft: ein
  Domainwechsel des Anbieters (aniworld.to zu aniworld.sx) muss durchgehen

Die Cloudflare-Abfrage von S.to ("Bist du ein Mensch?") geht unveraendert auf -
Turnstile, hCaptcha und reCAPTCHA stehen jetzt an einer Stelle und werden vor
jeder Blockade geprueft.

Watchparty bei S.to:
- Fortschritt kam in der Runde nicht an, und nach einem Folgenwechsel war es
  still. Beides hatte dieselbe Ursache: der Schluessel, unter dem ein Titel in
  der Runde laeuft, kommt aus dem Seitentitel, und "Staffel 1 Folge 2" wurde
  nur weggeschnitten, wenn ein Trennzeichen davorstand. S.to schreibt es ohne,
  also bekam jede Folge einen eigenen Schluessel, der zu keinem Raum-Eintrag
  passte. Zusaetzlich entscheidet jetzt die Adresse, falls ein Anbieter den
  Titel doch einmal anders schreibt
- Bestehende S.to-Eintraege in einer Runde bekommen dadurch einen neuen
  Schluessel und muessen einmal neu eingestellt werden

Der Sync-Knopf tut endlich das, was draufsteht:
- Er hat nie wieder gestartet - das Startsignal kannte die Wiedergabe nicht,
  also blieben alle pausiert stehen. Jetzt: alle anhalten, exakt auf die Zeit
  des Hosts springen, warten bis der Sprung wirklich sitzt und genug gepuffert
  ist, dann gemeinsam weiter
- Jede Pause zieht alle auf die Sekunde des Hosts, auch den, der gedrueckt hat
- Die mitgerechnete Laufzeit wurde bisher ermittelt und dann verworfen: alle
  lagen dauerhaft ein Stueck hinter dem Host
- Stellen laufen mit zwei Nachkommastellen statt gerundeter Sekunden

Am Relay (`sync-server/server.js` muss dafuer nachgezogen werden):
- "Der Host steht bei 0" war nicht von "vom Host ist nichts bekannt" zu
  unterscheiden. Direkt nach einem Folgenwechsel steht er bei 0 - der Abgleich
  lieferte deshalb gar keine Antwort mehr
- Eine neue Folge setzt den Stand der Runde zurueck. Wer dem Wechsel nur
  nachzieht, meldet dieselbe Adresse und faengt die Runde nicht noch einmal
  von vorn an
- Der zuletzt an alle geschickte Befehl ist der Stand der Runde, egal von wem
  er kam - sonst passt das, woran sich ein Abgleich orientiert, nicht zu dem,
  was auf den Geraeten laeuft
- `/health` nennt unter `features` jetzt `syncall` und `hostpause`

Kopfzeile:
- "Live aus" gibt es nicht mehr. Es bleiben zwei Zustaende: privat oder live
  in einer Runde. "Live beitreten" fragt bei mehreren Watchpartys, welche
  gemeint ist; "Live verlassen" stellt zurueck auf privat. Die Mitgliedschaft
  bleibt beides Mal bestehen
- Der Knopf steht jetzt in beiden Zustaenden da, nicht nur in der Runde

## 1.14.0 — 16. August 2026

Aus der Suche direkt auf die Watchlist:
- Jeder Treffer hat oben rechts ein Herz. Ein Klick nimmt den Titel auf die
  Watchlist, ohne ihn zu oeffnen; was schon drauf steht, ist beim Aufbau der
  Liste schon gefuellt
- Die Trefferkarte ist dafuer kein Knopf mehr, sondern ein anklickbarer
  Bereich - ein Knopf im Knopf waere kein gueltiges HTML. Klick und Enter
  oeffnen den Treffer weiter wie bisher
- Ein Treffer ohne eigene Adresse waere als Startseite des Anbieters auf der
  Watchlist gelandet: die leere Adresse loeste sich gegen die Basis auf. Wird
  jetzt abgelehnt

Live-Vorschau zeigt endlich alles:
- Der Einstellungsdialog liegt ausserhalb der App-Huelle. Farben und Radien
  kamen ueber die Variablen an, aber alles, was als Klasse auf der Huelle
  sitzt, wirkte dort gar nicht - Kartenstil, Ecken, Schatten, Navigationsstil,
  Anbieter-Kacheln und Dichte blieben unsichtbar. Die Modi werden jetzt auf
  die Vorschau gespiegelt, mit passenden Regeln dafuer
- Die Vorschau zeigt zusaetzlich, was es inzwischen gibt: Seitenleiste mit der
  Zahl an der Watchlist, die Reihe "Neue Folgen" mit Marken, "Gemeinsam
  weiterschauen" mit Raumangabe, Fortschrittsbalken in der eigenen Farbe und
  Anbieterkacheln mit Logo und Name. Statt vier grauer Flaechen stehen dort
  vier verschiedene Poster - sonst fielen Kartenstil und Ecken nicht auf

Kopfzeile:
- Favorit, Watchparty, Stop und Vollbild erscheinen nur noch auf einer
  Anbieterseite. Auf Startseite, Suche, Watchlist, Mediathek, Verlauf und
  Watchparty gibt es nichts, worauf sie sich beziehen koennten

## 1.13.0 — 16. August 2026

Neue Folgen zu abgeschlossenen Serien:
- Serien in der Mediathek werden im Hintergrund auf Nachschub geprueft: alle
  sechs Stunden nachgeschlagen, wie viele Staffeln es gibt und wie viele
  Folgen die letzte hat. Ist etwas dazugekommen, gilt die Serie wieder als
  offen, rueckt auf die erste neue Folge und kommt zurueck in die Watchlist
- In der Seitenleiste steht dann eine Zahl an der Watchlist, auf der
  Startseite eine eigene Reihe "Neue Folgen" mit "Staffel 4 ist da" oder
  "Folge 15 ist da". Der Hinweis verschwindet beim Oeffnen oder ueber
  "Gesehen"
- Filme werden nie geprueft, und ohne verlaessliche Angaben wird nichts geraten

Von Hand als gesehen abhaken:
- Ueber das ⋯ Menue in Watchlist und Weiterschauen wandert ein Titel in die
  Mediathek, ohne ihn durchlaufen zu muessen - mit Rueckfrage
- Der gespeicherte Stand bleibt liegen, und auch ein erneutes Ansehen holt den
  Titel nicht zurueck. Nur neue Folgen tun das

Eigene Bilder:
- Ueber dasselbe Menue laesst sich fuer jeden Titel ein eigenes Bild waehlen;
  es gilt auf den Kacheln und im grossen Bild der Startseite. Ohne eigenes
  Bild bleibt alles wie bisher
- Das Bild wird beim Auswaehlen auf Kachelgroesse gebracht, damit die Ablage
  nicht mit Megabytes vollaeuft. Die automatische Bildreparatur laesst ein
  eigenes Bild in Ruhe

Verlauf:
- Jeder Fortschritts-Takt schrieb bisher eine eigene Zeile - dieselbe Folge
  stand dutzendfach untereinander. Derselbe Vorgang innerhalb einer Stunde
  schreibt jetzt den vorhandenen Eintrag weiter, und was schon in der Ablage
  steht, wird beim Anzeigen zusammengefasst: eine Zeile mit Zeitspanne und
  der Zahl der Aufrufe
- Dazu Suche ueber Titel, Folge und Anbieter, Filter nach Zeitraum, Art und
  Anbieter, Ueberschriften je Tag und eine Zusammenfassung. Filtergruppen
  erscheinen nur, wenn es etwas zu waehlen gibt

Einstellungen:
- Beim Schliessen geht es zurueck zu der Ansicht, aus der sie geoeffnet
  wurden - aus der Watchparty also wieder dorthin. Bisher landete man immer
  auf der Startseite
- Der Einstellungen-Knopf in der Watchparty oeffnet gleich deren Bereich

Seitenleiste:
- Bei schmalem Fenster standen Wortmarke und Ersatzzeichen nebeneinander: der
  Umbruchpunkt blendet nur das Bild der Startseiten-Leiste aus, eine genauere
  Regel holte es in der App-Leiste zurueck. Vom Logo blieb ein angeschnittener
  Rest - sichtbar beim Wechsel auf einen kleineren Bildschirm

## 1.12.4 — 16. August 2026

Gemeinsame Staende ueberleben den Neustart:
- Nach dem Start trug die App ihre Mitgliedschaften nach und raeumte im selben
  Zug auf - die Bestaetigung vom Relay kommt aber erst mit dem naechsten
  Zustand. In diesem Moment meldet der Raum "nirgends dabei", also flogen alle
  Eintraege aus "Gemeinsam weiterschauen". Anschliessend wurde dieser leere
  Stand als Merkliste gespeichert, sodass beim naechsten Start nichts mehr
  nachzutragen war
- Aufgeraeumt und gemerkt wird jetzt erst, wenn der Raum-Zustand sechs
  Sekunden ruht. Ein Raum wird ausserdem nur angefasst, wenn seine Verbindung
  steht und seine Mitgliedschaften nachgetragen wurden
- Beim Beenden wird der Stand noch einmal gesichert, damit eine Aenderung der
  letzten Sekunden nicht verlorengeht

## 1.12.3 — 16. August 2026

Stand ueber 90 Prozent verschwand aus "Weiterschauen":
- Wer in einer Folge weit nach vorn sprang und die Seite verliess, fand den
  Eintrag nicht mehr in der Liste. Seit eine Folge erst mit 2:30 Minuten
  Wiedergabe als gesehen gilt, war ein solcher Stand weder offen noch fertig:
  die Filter fuer "Weiterschauen" verlangten weiterhin weniger als 90 Prozent,
  also fiel er durch beide Raster
- Diese Grenze ist jetzt raus - aus der Oberflaeche wie aus dem Hauptprozess.
  Ob eine Folge erledigt ist, steht in "gesehen" beziehungsweise "Folge
  fertig"; danach wird ohnehin gefiltert, und die Prozentzahl entscheidet das
  nicht mehr ein zweites Mal
- Ausgeblendete, abgeschlossene und nie begonnene Eintraege bleiben draussen
  wie bisher

## 1.12.2 — 16. August 2026

Weiterschauen getrennt:
- Auf der Startseite gibt es jetzt zwei Reihen: "Weiterschauen" mit dem
  eigenen Stand und darunter "Gemeinsam weiterschauen" mit dem, was in einer
  Watchparty laeuft. Die zweite Reihe erscheint nur, wenn dort etwas offen ist
- In der Weiterschauen-Ansicht dasselbe, durch einen Strich abgesetzt: oben
  die eigenen Titel, darunter die Runden. Auf den Karten steht weiterhin, zu
  welchem Raum ein Stand gehoert

Stand verschwindet mit der Runde:
- Wer eine Runde verlaesst, herausgeworfen wird, oder deren Titel jemand
  herausnimmt, behaelt keinen Stand mehr davon. Dasselbe gilt, wenn ein Raum
  aus den Einstellungen entfernt wird - bisher blieb die Karte stehen, ohne
  dass es die Runde noch gab
- Zwei Sicherungen dagegen: Bei fehlender Verbindung und bei ausgeschalteter
  Watchparty wird nichts geloescht. Ein Aussetzer darf keine Staende kosten
- Der eigene, private Stand bleibt in jedem Fall unberuehrt
- Wer einen Watchparty-Titel nur oeffnet, ohne beigetreten zu sein, bekommt
  keinen Runden-Eintrag mehr: ohne Mitgliedschaft gibt es keinen gemeinsamen
  Stand

## 1.12.1 — 16. August 2026

Immer sichtbar, wofuer das Geschaute zaehlt:
- Die Anzeige oben sagt jetzt in jedem Fall, ob gerade privat oder fuer eine
  bestimmte Runde geschaut wird - "Privat" oder der Raum samt Live-Zustand.
  Sie ist zugleich der Schalter: ein Klick oeffnet ein Fenstermenue mit
  "Privat (nur fuer dich)" und allen Runden, in denen der Titel laeuft, die
  aktuelle mit Haken. Die Wahl gilt sofort fuer Fortschritt, Live-Steuerung
  und Abgleich
- Beim Wechsel auf privat endet nur die Live-Steuerung; die Mitgliedschaft im
  Raum bleibt bestehen

Eindeutig beim Hereinkommen:
- Ueber die Watchparty geoeffnet gilt diese Runde, ueber Weiterschauen die
  Runde der Karte (oder privat), ueber Suche und Adresszeile privat. Bisher
  wurde eine Runde automatisch angenommen, sobald der Titel in genau einer
  stand - auch beim Einstieg ueber die Suche. Jetzt zaehlt nur, was wirklich
  geoeffnet oder oben ausgewaehlt wurde

Knoepfe in der Kopfzeile:
- "Sync" und "Live verlassen" blieben immer stehen. Der Code setzte zwar
  "is-hidden", nur gab es dafuer keine Regel im Stylesheet - die galt allein
  fuer die Live-Anzeige. Damit standen sie auch ausserhalb jeder Watchparty in
  der Leiste. Ausserhalb einer Runde sind sie jetzt weg, und bei "Privat"
  ebenso

## 1.12.0 — 16. August 2026

Jede Watchparty steht fuer sich:
- Jede Runde fuehrt ihren eigenen Weiterschauen-Eintrag. Derselbe Anime in
  zwei Raeumen steht zweimal in der Liste, jeweils mit dem Raum unter dem
  Titel und dem Stand dieser Runde. Bisher teilten sich alle Raeume einen
  Eintrag, und der zuletzt gemeldete Stand ueberschrieb den anderen
- Welche Runde gilt, entscheidet der geoeffnete Eintrag. Aus der Watchparty-
  Karte von "Bangus" geoeffnet, laeuft der Fortschritt in den Bangus-Eintrag.
  Dafuer hat der gerade geoeffnete Eintrag beim Speichern Vorrang - vorher
  traf es immer den erstbesten mit gleichem Titel
- Der Eintrag ohne Raum ist der eigene und bleibt privat: aus ihm fliesst
  nichts mehr in eine Watchparty
- Steht derselbe Anime in mehreren Runden, fragt "Live beitreten" ueber ein
  Fenstermenue, welcher man folgt. Danach haengen Live-Schalter, Sync und
  Steuerung an dieser Runde
- Live wird je Raum gefuehrt: in der einen Runde live, in der anderen nicht,
  beim selben Anime
- Steuerbefehle aus einer anderen Runde werden nicht mehr befolgt. Vorher
  hielt eine Pause dort die eigene Wiedergabe hier mit an

## 1.11.3 — 16. August 2026

Updates laufen still durch:
- Der Installer zeigte bei jedem Update seine Seiten und wartete auf einen
  Klick ("Fuer wen soll installiert werden?"). Er ist jetzt als Ein-Klick-
  Installer gebaut und wird still gestartet: ELFIX laedt, installiert und
  startet von selbst neu. Installiert wird wie bisher nur fuer den
  angemeldeten Benutzer, in denselben Ordner

Wann eine Folge als gesehen gilt:
- Ueber 90 Prozent genuegte bisher allein. Wer hineinsprang und den Regler
  ans Ende zog, hatte die Folge in einer Sekunde durch - samt Vorruecken und,
  an der letzten Folge, Abschliessen der ganzen Serie. Jetzt muss beides
  zusammenkommen: ueber 90 Prozent und 2:30 Minuten tatsaechlich gelaufen
- Bei Folgen, die kuerzer als 2:30 sind, gelten stattdessen 90 Prozent ihrer
  Laufzeit - sonst liessen sich Specials und Kurzfolgen nie abschliessen
- Zurueck auf eine aeltere Folge bleibt bei einer Minute, und eine Folge, die
  gerade in der Watchparty laeuft, zaehlt weiterhin sofort

Watchparty-Knoepfe:
- "Sync" und "Live beitreten" blieben stehen, wenn gar keine Anbieterseite
  offen war: Startseite, Mediathek und Einstellungen legen sich als eigene
  Ansicht darueber, die zuletzt geladene Adresse blieb aber stehen. Sie
  erscheinen jetzt nur noch, solange wirklich eine Seite offen ist, die zu
  einer beigetretenen Serie gehoert - und verschwinden beim Wechsel sofort

Naechste Folge:
- Der Knopf ueber dem Bild wird nach fuenf Sekunden ohne Mausbewegung fast
  durchsichtig und kommt bei der naechsten Bewegung sofort zurueck. Liegt der
  Zeiger auf ihm, bleibt er sichtbar; startet der Countdown, meldet er sich
  von selbst wieder

## 1.11.2 — 16. August 2026

Mediathek:
- Eintraege lassen sich ueber das ⋯ Menue loeschen, mit Rueckfrage und dem
  Titel darin. Geloescht wird wirklich: das bisherige "Entfernen" nimmt einen
  geschauten Titel nur aus der Watchlist, in der Mediathek stand er weiter
- Die Reihenfolge laesst sich mit der Maus umstellen. Beim Ziehen wandert die
  Karte mit, die gezogene bleibt blass sichtbar, damit die Luecke erkennbar
  ist. Losgelassen wird sofort gespeichert - am Eintrag selbst, also bleibt
  sie nach einem Neustart und verschwindet mit ihm. Frisch abgeschlossene
  Titel stehen weiter oben. Der Klick nach dem Loslassen oeffnet nichts mehr

Ein Geraet, mehrere Raeume:
- Wer keine feste Kennung hatte, bekam von jedem Raum eine eigene. Damit galt
  man in einem Raum als dabei und im naechsten als fremd: der Beitritt im
  einen warf einen aus dem anderen. Jetzt gilt eine Kennung fuer alle Raeume
- Die Kennung ging beim Speichern der Einstellungen verloren, weil sie nicht
  im Formular steht - und seit "Raum hinzufuegen" mitspeichert, bei jedem
  Raumwechsel. Sie wird jetzt mitgefuehrt, auch beim Zuruecksetzen, und der
  Hauptprozess behaelt eine bekannte Kennung, statt eine neue zu vergeben
- Benennt jemand sein Geraet um, zieht das Relay den Namen ueberall nach:
  Mitgliederliste, Host-Anzeige und "eingestellt von". Vorher stand dort
  weiter der alte Name
- Die Anzeige "du bist Host" haengt an der Kennung statt am Namen. Ueber den
  Namen sah man sich als Host, obwohl man gar nicht mehr dabei war

Weiterschauen:
- Eine zu Ende geschaute Folge rueckte nicht nach, solange die Folgenzahl der
  letzten Staffel unbekannt war - bei Pokemon mit 25 Staffeln also immer. Der
  Titel fiel damit aus "Weiterschauen". Diese Zahl zaehlt jetzt nur noch in
  der letzten Staffel; davor geht es normal weiter, am echten Serienende wird
  weiterhin nichts geraten
- Meldet die Watchparty eine fertige Folge, rueckt der eigene Eintrag sofort
  nach statt erst beim naechsten Start

## 1.11.1 — 16. August 2026

Raeume mit Umlaut:
- Das Relay liess nur A-Z, Ziffern, Bindestrich und Unterstrich zu. Ein Raum
  wie "Gummikaese" mit Umlaut wurde abgewiesen, und die App zeigte nur "0
  verbunden", ohne den Grund zu nennen. Jetzt sind Buchstaben aller Sprachen
  erlaubt
- Umlaute werden zusammengezogen (NFC). Je nach Tastatur kommt "ä" als ein
  Zeichen oder als a mit Trema - vorher waren das zwei verschiedene Raeume
- Beim Eintragen prueft die App nach derselben Regel und sagt den Grund
  sofort, statt ihn erst beim Verbinden zu melden

Auswahl beim Teilen:
- Die Abfrage, in welchen Raum ein Titel soll, war aus HTML gebaut. Die Seite
  des Anbieters liegt aber als eigene Ansicht darueber: das Kaestchen war
  abgeschnitten und die Klicks landeten im Player. Jetzt oeffnet sich ein
  Fenstermenue, das darueber liegt. Raeume ohne Verbindung stehen mit Grund
  darin und sind gesperrt

Uebersicht:
- Die Abschnitte richteten sich danach, in welchen Raeumen schon Titel stehen.
  Lagen alle im selben Raum, fehlte jede Ueberschrift und der zweite Raum kam
  gar nicht vor. Jetzt bekommt jeder eingerichtete Raum seinen Abschnitt -
  auch ein leerer -, mit der Zahl der Geraete oder dem Verbindungsproblem

## 1.11.0 — 15. August 2026

Mehrere Watchpartys nebeneinander:
- Aus dem einen Raumcode ist eine Liste geworden. Codes werden einzeln
  eingetragen und stehen als Marken mit Verbindungspunkt darunter, bis zu acht
  Raeume. Der bisherige Code wandert beim Update von selbst in die Liste,
  ebenso die gespeicherten Mitgliedschaften - eine laufende Runde bleibt
- Jeder Raum ist eine eigene Verbindung. Verwaltendes - einstellen, beitreten,
  entfernen, rauswerfen - geht an genau einen Raum. Alles rund ums Schauen -
  Fortschritt, Pause, Springen, Abgleich - geht an jeden Raum, in dem der
  Titel mitlaeuft. Dieselbe Serie in zwei Raeumen laeuft also in beiden mit
- Der ⇄ Knopf fragt bei mehreren Raeumen, wohin der Titel soll, und nennt je
  Raum die Zahl der Titel und der verbundenen Geraete. Bei einem Raum wie
  bisher ohne Nachfrage
- In der Uebersicht bekommt jeder Raum einen eigenen Abschnitt; die Live-
  Anzeige oben sagt, welcher Raum gerade laeuft

Relay:
- Wer eine Serie verlassen hat oder herausgeworfen wurde, blieb Host. Alle
  anderen glichen sich weiter mit jemandem ab, der nicht mehr mitschaute.
  Jetzt wird bei Verlassen, Rauswerfen und Verbindungsabbruch neu bestimmt,
  und ist niemand mehr da, bleibt kein Name stehen. Das galt auch fuer eine
  einzelne Watchparty

## 1.10.0 — 15. August 2026

Watchparty:
- Es gibt immer einen Host. Bisher wurde er einmal gesetzt und blieb stehen,
  auch wenn derjenige laengst offline war. Jetzt wird bei jedem Anlass geprueft,
  ob er noch verbunden ist - faellt er weg, uebernimmt der naechste Teilnehmer
- Wer der Host ist, steht in der Kopfzeile ("Live · Host: David") und auf der
  Karte vor den Mitgliedern
- "⟲ Sync" richtet sich nach der Zeit des Hosts. Vorher zaehlte die Stelle
  dessen, der gedrueckt hat - ein Nachzuegler zog damit alle anderen zu sich
  zurueck. Die eigene Stelle gilt nur noch, wenn vom Host nichts bekannt ist
- Der Stand des Hosts wird auch aus seinem laufenden Fortschritt abgeleitet,
  nicht nur aus seinen Steuerbefehlen: schaut er einfach durch, weiss der Raum
  trotzdem, wo er steht
- Wer eine Folge verlaesst und zurueckkommt, gleicht wieder mit dem Host ab.
  Der Merker dafuer galt vorher dauerhaft und verhinderte das

Oberflaeche:
- Neu laden zeigt einen laufenden Ring, solange wirklich geladen wird - der
  Hauptprozess meldet dafuer jetzt den Ladezustand. "Alles neu laden" sagt
  danach, wie viele Anbieter neu geladen wurden. Denselben Ring nutzt der
  Abgleich in der Watchparty
- In der Seitenleiste stand bei mittleren Fensterbreiten ein angeschnittenes
  Logo: die Wortmarke verschwand ab 1180 Pixeln, das Ersatzzeichen kam aber
  erst ab 980. Dazwischen wurde das Bild nur gequetscht

## 1.9.3 — 15. August 2026

Behoben:
- Der Vorrang der Watchparty beim Fortschritt galt nur beim Zurueckspringen.
  Wechselte die Gruppe auf eine spaetere Folge, wartete der eigene Eintrag
  trotzdem zweieinhalb Minuten, obwohl alle dieselbe Folge schauten. Laeuft
  eine Folge in der Watchparty, zaehlt sie jetzt in beide Richtungen sofort

Unveraendert bleibt: nach vorne zaehlt eine Folge ohne Watchparty erst nach
zweieinhalb Minuten, zurueck nach einer Minute, und eine durchgelaufene Folge
immer.

## 1.9.2 — 15. August 2026

Live-Zustand:
- Der Zustand wurde nur im Fortschritts-Takt gemeldet - und der laeuft nur bei
  offener Medienseite. Umschalten wirkte dadurch verzoegert, und beim Wechsel
  auf eine andere Seite blieb die alte Anzeige stehen. Gemeldet wird jetzt bei
  jedem Anlass sofort: Umschalten, Seiten- und Folgenwechsel, Aenderungen im
  Raum und Verbindungswechsel
- Verbindungsabbrueche sind sichtbar ("Verbindung weg …", rote Anzeige). Solange
  keine Verbindung steht, sind die Knoepfe gesperrt - steuern liesse sich
  ohnehin nichts
- "⟲ Sync" erscheint nur noch, wenn Live wirklich an und die Verbindung da ist

Fortschritt bei aelteren Folgen:
- Eine aeltere Folge wurde nie uebernommen: der Eintrag liess sich praktisch
  nur ueber Umwege zurueckstellen. Jetzt zaehlt bewusstes Schauen - ab einer
  Minute oder wenn die Folge durchlaeuft. Kurzes Reinschauen aendert weiterhin
  nichts
- Gibt die Watchparty die Folge vor, zaehlt sie sofort. Sonst haengt der eigene
  Eintrag hinter der Gruppe, wenn gemeinsam zurueckgesprungen wird

## 1.9.1 — 15. August 2026

Behoben:
- "Live aus" stand da, obwohl live lief. Der Zustand haing an der Folge des
  Raum-Eintrags: wer weiter war als der gespeicherte Stand, galt als nicht
  live. Live gilt jetzt fuer die Serie - wer Mitglied ist, Live anhat und
  irgendeine Folge davon offen hat, ist live, auch bei pausiertem Player.
  Damit greift auch "Live beitreten" wieder zuverlaessig
- Steuerbefehle wirken weiterhin nur bei genau derselben Folge; nur die
  Anzeige und der Schalter haengen an der Serie

Gemeinsam gleichziehen:
- "⟲ Sync" haelt jetzt alle an, setzt sie auf dieselbe Stelle und startet sie
  zusammen, statt nur den eigenen Stand nachzuziehen. Wer die falsche Folge
  offen hat, wechselt vorher dorthin
- Waehrend des Abgleichs steht in der Kopfzeile, worauf gewartet wird
  ("Wird abgeglichen auf 12:34 …")
- Meldet sich ein Geraet nicht, startet der Raum nach vier Sekunden trotzdem -
  lieber leicht versetzt als gar nicht

## 1.9.0 — 15. August 2026

Live zuschauen, zweiter Schritt:
- Wechselt jemand die Folge, ziehen die anderen nach - aber nur, wenn sie bei
  derselben Serie stehen. Wer woanders ist, bleibt, wo er ist
- Es gibt einen Host: wer zuerst spielt, gibt den Takt vor. Sein Stand ist die
  Referenz fuer alle, die spaeter dazukommen
- Neuer Knopf "⟲ Sync" holt Folge und Stelle des Hosts. Beim Oeffnen einer
  Folge, die live mitlaeuft, passiert das automatisch - man haengt sich also
  ohne Zutun an
- Die Zeit auf dem Weg wird mitgerechnet: bei laufender Wiedergabe zaehlt die
  Uebertragungsdauer mit, sonst landet man immer ein Stueck hinter dem anderen
- "Live verlassen" trennt nur noch die gemeinsame Steuerung. Die Mitgliedschaft
  in der Watchparty und der geteilte Fortschritt bleiben bestehen; derselbe
  Knopf heisst danach "Live beitreten"

## 1.8.1 — 15. August 2026

Behoben:
- Ausserhalb des Vollbilds verrutschte die Oberflaeche, sobald jemand steuerte.
  Der Live-Streifen sass ueber der Anbieteransicht und nahm dieser den Platz
  weg. Er sitzt jetzt in der Kopfzeile - der Player ist eine eigene Ansicht
  ueber der Oberflaeche, alles davor wird entweder verdeckt oder verschiebt
  das Layout
- Steuerbefehle galten fuer die ganze Serie statt fuer die laufende Folge: der
  Schluessel wirft Staffel und Folge weg. Wer in Folge 2 war, wurde von Folge 3
  mitpausiert. Verglichen wird jetzt Staffel und Folge genau; Filme ohne
  Folgenangabe bleiben davon unberuehrt
- Oben rechts steht jetzt "Live verlassen", solange die laufende Folge live
  mitlaeuft. Damit endet die gemeinsame Steuerung, ohne die Watchparty selbst
  anzufassen

## 1.8.0 — 15. August 2026

Live zuschauen:
- Pause, Weiter und Springen gelten fuer alle, die einer Serie beigetreten sind.
  Wer pausiert, pausiert bei allen; wer springt, nimmt die anderen mit
- Ein kleines Skript im Player-Frame horcht auf die Ereignisse des Videos und
  meldet sie ueber die Konsole zurueck - denselben Rueckkanal nutzt schon der
  "Naechste Folge"-Knopf. Waehrend eine fremde Anweisung ausgefuehrt wird,
  schweigt das Geraet, sonst schaukeln sich zwei Player gegenseitig auf
- Wer spaeter dazukommt, landet ueber "Oeffnen" an der Stelle der anderen und
  haengt sich damit ohne Umweg an
- Ueber dem Player steht, wer gerade steuert ("Live: King PC hat pausiert").
  Der Streifen verschwindet, wenn eine Weile nichts mehr kommt
- Das Relay reicht die Befehle nur an Beigetretene weiter und speichert sie
  nicht - es zaehlt allein der Moment

## 1.7.1 — 15. August 2026

Watchparty:
- Fehlte einer Serie im Raum das Bild - weil das einstellende Geraet keines
  hatte -, blieb die Karte grau, obwohl dasselbe Geraet den Titel in
  "Weiterschauen" mit Bild fuehrt. Jetzt wird das eigene Bild angezeigt und
  einmalig an den Raum nachgereicht, damit auch die anderen es sehen. Nur dort,
  wo dieses Geraet ohnehin Mitglied ist: ein Bild ist kein Beitritt
- "Oeffnen" verhaelt sich jetzt wie eine Karte aus "Weiterschauen": Vorhang,
  Autostart und Vollbild. Bisher wurde die Seite nur aufgerufen und blieb
  stehen. Der Sprung an die Stelle des anderen Geraets bleibt erhalten

## 1.7.0 — 15. August 2026

Weiterschauen und Watchparty wachsen zusammen:
- Auf der Startseite fehlte der Fortschrittsbalken. Die Reihe rief die Karten
  ohne die Fortschrittsanzeige auf, waehrend die Vollansicht sie hatte
- Schaut jemand aus der Watchparty gerade einen Titel, steht das jetzt auf der
  Karte ("King PC schaut gerade"), und der Balken zeigt dessen Stand. Nach zwei
  Minuten ohne neue Meldung verschwindet der Hinweis wieder
- Beim Oeffnen einer Watchparty-Folge wird an die Stelle gesprungen, an der das
  andere Geraet steht - egal ob aus der Watchparty-Ansicht oder ueber die
  Weiterschauen-Karte. Bisher fing die Anbieterseite bei ihrem eigenen Stand an
- Der Sprung wird erst ausgeloest, wenn wirklich ein Video laeuft, und nur bei
  mehr als acht Sekunden Abweichung. Bleibt die Folge aus, verfaellt er nach
  drei Minuten

## 1.6.2 — 15. August 2026

Behoben - Beitreten schlug auf dem zweiten Geraet fehl:
- Eine App ohne gespeicherte Geraete-Kennung schickte eine leere mit. Das Relay
  vergab daraufhin eine eigene, die die App nicht kannte - sie erkannte sich in
  der Mitgliederliste nicht wieder. Der Knopf blieb auf "Beitreten", die
  Bestaetigung lief in den Timeout ("Der Raum hat nicht geantwortet"), und weil
  die App sich fuer nicht beigetreten hielt, meldete sie nie Fortschritt. Auf
  dem anderen Geraet stand das Mitglied trotzdem in der Liste
- Das Relay teilt jedem Geraet jetzt mit, unter welcher Kennung es gefuehrt
  wird; die App uebernimmt und speichert sie

Behoben - Fortschritt kam nicht an:
- Der Zeitpunkt einer Meldung kam vom Geraet. Gehen die Uhren auseinander,
  galten die Meldungen des einen dauerhaft als aelter und wurden verworfen.
  Den Zeitpunkt setzt jetzt das Relay, und der Empfaenger vergleicht ihn nicht
  mehr mit seiner eigenen Uhr

## 1.6.1 — 15. August 2026

Watchparty bleibt bestehen:
- Die App merkt sich, welche Serien sie eingestellt hat und wo sie dabei ist.
  Beim Verbinden traegt sie nach, was im Raum fehlt - dadurch ueberlebt die
  Watchparty ein Update der App, einen Neustart des Relays und selbst ein
  Relay, das gar keine Ablage kennt
- Bewusst Verlassenes bleibt draussen: beim Verlassen faellt der Titel aus der
  lokalen Liste, es wird also nichts ungefragt wieder beigetreten
- Die Merkliste liegt neben den Favoriten in den Anwendungsdaten und ist von
  einer Neuinstallation der App nicht betroffen

## 1.6.0 — 15. August 2026

Watchparty:
- Wer eine Serie eingestellt hat, kann einzelne Mitglieder wieder herauswerfen.
  Der eigene Name steht dabei nicht zur Auswahl
- Der Fortschritt eines Mitglieds steht jetzt direkt auf der Karte und
  aktualisiert sich beim Schauen. Bisher kam er zwar an, wurde aber nie in die
  angezeigte Liste uebernommen - es sah aus, als tue sich minutenlang nichts
- Raeume liegen auf der Platte statt nur im Arbeitsspeicher. Ein Neustart des
  Relays kostete bisher alle Mitgliedschaften, jeder musste neu beitreten.
  Die systemd-Vorlage legt das Verzeichnis dafuer selbst an (StateDirectory)
- Meldet sich ein Geraet mit gleichem Namen, aber neuer Kennung - etwa nach
  einer Neuinstallation -, uebernimmt das Relay dessen Mitgliedschaften. Vorher
  stand derselbe Name doppelt in der Liste und musste ueberall neu beitreten

## 1.5.5 — 15. August 2026

Behoben:
- Nach dem Entfernen blieb die Karte stehen, obwohl daneben schon "Noch nichts
  eingestellt" stand. Das Gitter wurde nur mit der Klasse "is-hidden" versehen -
  fuer ".favorite-grid" gibt es im Stylesheet aber gar keine Ausblend-Regel, die
  Klasse blieb also wirkungslos. Statt darauf zu bauen, wird das Gitter jetzt
  geleert

## 1.5.4 — 15. August 2026

Behoben:
- Beitreten und Verlassen schalteten hin und her. Die Knoepfe arbeiteten mit dem
  Stand vom Renderzeitpunkt: ein zweiter Klick schickte dieselbe Aktion noch
  einmal, und weil eine Rueckmeldung fehlte, klickte man nach - im Log zeigte
  sich das als Wechsel zwischen "1 dabei" und "0 dabei", in der Oberflaeche als
  doppelte Meldung
- Die Knoepfe richten sich jetzt nach dem aktuellen Stand, sind waehrend der
  Anfrage gesperrt und melden erst, wenn der Raum die Aenderung bestaetigt hat.
  Bleibt sie aus, sagt die Meldung das auch - statt Erfolg vorzutaeuschen
- Gleiches gilt fuer "Entfernen"

## 1.5.3 — 15. August 2026

Behoben:
- Der Knopf "Entfernen" verschwand, sobald das Relay noch eine aeltere Fassung
  fuhr: die Anzeige haengte hart an der neuen Geraete-Kennung, die ein altes
  Relay gar nicht mitschickt. Fehlt sie, wird wieder der Name verglichen -
  damit bleibt die App auch an einem nicht aktualisierten Relay bedienbar

## 1.5.2 — 15. August 2026

Behoben:
- Wer eine Serie in den Raum gestellt hat, wurde ueber den Geraetenamen erkannt.
  Der Renderer verglich dabei gegen den gespeicherten Namen, der Server gegen
  seinen eigenen Ersatzwert - dadurch erschien der Knopf "Entfernen" auch dort,
  wo er nichts bewirkte. Besitz und Mitgliedschaft haengen jetzt an der
  Geraete-Kennung, die weder doppelt vorkommt noch sich aendert
- Die Geraete-Kennung wurde beim Start zwar erzeugt, aber nie gespeichert. Nach
  jedem Neustart war es damit ein anderes Geraet und fiel aus seinen eigenen
  Mitgliedschaften heraus. Sie wird jetzt beim ersten Start festgeschrieben
- Die Watchparty-Ansicht haelt im Log fest, welche Titel mit wie vielen
  Mitgliedern ankommen - vorher liess sich von aussen nicht unterscheiden, ob
  eine Meldung fehlte oder nur nicht angezeigt wurde

## 1.5.1 — 15. August 2026

Behoben:
- Der Release-Build brach ab: beim Hochsetzen der Version wurde in
  package-lock.json per Textersetzung gearbeitet, wodurch auch fremde Pakete
  mit derselben Versionsnummer umgeschrieben wurden - zuletzt elf Stueck. Die
  Lock-Datei ist aus dem letzten unversehrten Stand wiederhergestellt, die
  Projektversion wird jetzt gezielt in den beiden Feldern gesetzt, die sie
  wirklich meinen. "npm ci" laeuft wieder durch
- Der Knopf "Zur Watchparty" meldete Erfolg, sobald die Nachricht abgeschickt
  war. Faehrt das Relay noch eine aeltere Fassung, verwirft es sie stumm - die
  Serie tauchte nie auf, gemeldet wurde trotzdem "hinzugefuegt". Bestaetigt wird
  jetzt erst, wenn der Raum die Serie zurueckspiegelt; bleibt das aus, sagt die
  Meldung, dass das Relay veraltet sein koennte

## 1.5.0 — 15. August 2026

Watchparty auf Beitreten umgestellt:
- Nichts wird mehr von selbst geteilt. Ueber den neuen Knopf neben dem
  Watchlist-Herz stellt man die geoeffnete Serie in den Raum
- Alle im Raum sehen sie als Vorschlag mit Titel, Folge und den Mitgliedern.
  Per Knopf tritt man bei oder verlaesst wieder; wer sie eingestellt hat, kann
  sie auch entfernen
- Erst nach dem Beitreten fliesst der Fortschritt dieser Serie - und nur
  zwischen den Beigetretenen. Was man sonst schaut, bleibt fuer sich
- Der gemeinsame Stand landet jetzt auch in der eigenen Weiterschauen-Liste:
  schaut ein Mitglied weiter, springt der Eintrag mit. Fehlt die Serie noch,
  wird sie angelegt, sofern ein passender Anbieter eingerichtet ist
- Wer spaeter beitritt, bekommt den bereits erreichten Stand
- Jedes Geraet bekommt eine feste Kennung in den Einstellungen, sonst waere die
  Mitgliedschaft nach jedem Neustart verloren

Relay:
- Verwaltet Mitgliedschaften je Serie und reicht Fortschritt ausschliesslich an
  Mitglieder weiter. Meldungen von Nichtmitgliedern werden verworfen
- Anleitung fuer Linux und Cloudflare Tunnel im README, dazu eine
  systemd-Vorlage

Behoben:
- Ansichten ueberlagerten sich: jede Ansicht zaehlte die anderen einzeln auf,
  wodurch eine neu hinzugekommene zwangslaeufig vergessen wurde. Die Watchparty
  blieb dadurch sichtbar, wenn man danach auf die Startseite wechselte. Alle
  Wechsel laufen jetzt ueber eine gemeinsame Stelle

## 1.4.0 — 15. August 2026

Watchparty - Weiterschauen zwischen mehreren Geraeten teilen:
- Eigener Eintrag in der Seitenleiste unter Bibliothek mit eigener Ansicht. Was
  die anderen im Raum schauen, steht ausschliesslich dort - die eigene
  Weiterschauen-Liste, die Watchlist und die Mediathek bleiben unberuehrt
- Die Karten zeigen Folge, Geraet und Anbieter und lassen sich anklicken. Titel
  ohne passenden eigenen Anbieter werden gedaempft dargestellt statt ins Leere
  zu fuehren
- Abgeglichen wird ueber Medientyp und Titel, nicht ueber die Adresse: dieselbe
  Serie liegt bei jedem unter einem anderen Anbieter, S.to laeuft hier ueber
  eine IP und anderswo ueber die Domain
- Uebertragen wird nur der Fortschritt. Die Wiedergabe laeuft auf jedem Geraet
  fuer sich
- Ein spaeter beitretendes Geraet bekommt den Stand des Raums nachgereicht, ein
  aelterer Stand ueberschreibt nie einen neueren
- Beim Wechsel von Raum oder Server wird die geteilte Liste geleert
- Einstellungen unter Watchparty: Server, Raumcode, Geraetename, dazu der
  Verbindungszustand

Relay in sync-server/:
- Kleiner WebSocket-Server ohne Datenbank und ohne Konten, haelt nur den letzten
  Stand je Titel im Arbeitsspeicher. Genau eine Abhaengigkeit, kein nativer
  Code - laeuft auf jedem Free-Tier-Hoster und unter Linux
- systemd-Vorlage fuer den Dauerbetrieb, bewusst ohne Schreibrechte
- Anleitung im README fuer Linux Mint und Cloudflare Tunnel, inklusive der
  Node-Version, die Mint 21 nicht mitbringt

Behoben:
- Ein Fehler beim Einarbeiten fremder Meldungen verschwand still im
  Ereignis-Handler: die Meldung kam an, es passierte nichts, und es gab keine
  Spur davon. Solche Faelle werden jetzt festgehalten

## 1.3.0 — 15. August 2026

Vorschlaege auf der Startseite:
- Neue Reihe "Empfohlen fuer dich": aus dem Verlauf entsteht ein Geschmacksprofil
  aus gewichteten Genres - frisch Geschautes und Durchgeschautes zaehlen mehr.
  Passende Titel kommen aus den Aehnlichkeitslisten der Anbieter ("Das schauen
  andere", "Verwandte Filme"), aus den Lieblingsgenres und von den Startseiten
- Genres werden ueber Anbieter hinweg vereinheitlicht, damit "Comedy" bei S.to
  und "Komoedie" bei AniWorld zusammenfinden
- Drei Kategoriereihen: "Anime fuer dich", "Serien fuer dich", "Filme fuer dich".
  Der Medientyp wird an der Adresse abgelesen, Anime-Filme bleiben bei Anime
- Alle Reihen teilen sich einen Durchlauf und sind ueberschneidungsfrei: was
  schon in einer Reihe steht, taucht in keiner zweiten auf
- Detailseiten liegen sieben Tage im Cache, Genre-Listen sechs Stunden
- Zwei neue Schalter unter Einstellungen > Startseite

Neu bei deinen Anbietern:
- Die Reihe liest jetzt gezielt den Neuheiten-Abschnitt der Startseite ("Neue
  Animes", "Neu auf SerienStream", "Neu veroeffentlichte Filme") statt der
  ganzen Seite, dazu das grosse Titelbild bei Filmo
- Aktualisiert sich alle 15 Minuten, solange die Startseite offen ist

Behoben:
- Der Hauptprozess erreichte aniworld.to und filmo.to nicht: Nodes fetch lief
  dort in einen Timeout, waehrend dieselbe Adresse in der Browser-Ansicht laedt.
  Abrufe laufen jetzt ueber Chromiums Netzwerkschicht, dadurch sind wieder alle
  Anbieter in den Reihen vertreten
- Zusammengefasste Folgen: S.to listet Doppelfolgen mit "[In E18 enthalten]"
  ohne Hoster. Solche Folgen beenden keine Staffel mehr und werden beim
  Weiterschauen uebersprungen, dadurch laesst sich die Serie abschliessen
- Am Ende einer Staffel geht es in die naechste Staffel weiter. Vorher brach die
  Weiterschaltung ab, sobald die laufende nicht die letzte Staffel war - die
  Folge galt als fertig, der Eintrag verschwand aus Weiterschauen und kam nie in
  der Mediathek an
- Beim Start werden so haengengebliebene Eintraege eingesammelt und auf die
  naechste abspielbare Folge gesetzt
- Vorschaubilder: Fuellwoerter wie "der" oder "the" zaehlen beim Abgleich nicht
  mehr mit, sonst galt das Poster eines Vorschlags als passend. Ausserdem
  gelten titelfaehige Woerter (avatar, black, flag) nur noch im Ordnerpfad als
  Ausschluss - im Dateinamen steht der Name der Serie, weshalb ausgerechnet
  "Avatar" nie sein eigenes Cover bekam
- Falsch gespeicherte Bilder werden beim Laden verworfen und neu geholt
- Kachel-Titel von AniWorld ohne "Cover"-Beiwerk und ohne Folgennummer

## 1.2.0 — 15. August 2026

Naechste Folge wie bei Netflix:
- Ab 90 Prozent erscheint unten rechts ein "Naechste Folge"-Knopf, direkt in der
  Anbieterseite und in dem Frame, in dem auch das Video liegt
- Am echten Ende (nicht schon bei der 90-Prozent-Markierung) laeuft ein
  5-Sekunden-Countdown mit Abbrechen, danach wird gewechselt
- Beide Wege laden die naechste Folge, starten sie und gehen ins Vollbild,
  hinter demselben Vorhang wie der Start aus Weiterschauen
- Link zur naechsten Folge wird zusaetzlich im Hauptdokument gesucht, weil das
  Video im Frame des Hosters liegt und dort keine Folgenliste steht

Behoben:
- Autoplay wartet auf die Zielseite: vorher startete der erste Versuch das
  gerade beendete Video der alten Seite neu und verbrauchte den Auftrag
- Frame-Scripts haben ein Zeitlimit: ein Frame, der beim Wechsel neu aufgebaut
  wird, loeste sein Versprechen nie ein und blockierte den Autoplay dauerhaft
- Protokoll [ELFIX FOLGE] fuer den gesamten Ablauf des Folgenwechsels

## 1.1.0 — 14. August 2026

Desktop:
- Weiterschauen: Filme zaehlen einzeln, Fortschritt unter 1% verschwindet nicht mehr
- Autostart aus Weiterschauen: Player startet und geht ins Vollbild, Vorhang bis es laeuft
- Vollbild entspricht dem Knopf im Player statt die ganze Seite aufzuziehen
- Verlauf loeschbar inkl. zuletzt gesuchter Begriffe, mit eigenem Dialog im App-Design
- Einstellungen neu geordnet: 7 Bereiche statt 16 Tabs, jede Option erklaert,
  keine doppelten Regler, kein einfacher Modus mehr
- Theme hell/dunkel/OLED wirkt jetzt wirklich, Navigation links/rechts/kompakt
- Startseite: Held wechselt durch die letzten Titel, Reihen scrollen mit dem Mausrad
- Neue Reihe "Neu bei deinen Anbietern" aus den Startseiten von AniWorld, S.to und Filmo
- Startseite scrollt wieder - Inhalte unterhalb des Fensters waren nicht erreichbar

Android: Stand aus dem Arbeitsbaum uebernommen.

## 1.0.9 — 11. August 2026

- Mehr Einstellmoeglichkeiten im Einstellungsbereich

## 1.0.8 — 11. August 2026

- Die App startet im Vollbild

## 1.0.7 — 11. August 2026

- Bei AniWorld werden nur noch Cover als Titelbild genommen

## 1.0.6 — 11. August 2026

- Kein automatisches Veroeffentlichen mehr durch electron-builder im Release-Workflow

## 1.0.4 — 11. August 2026

- Android-Upload laeuft nacheinander statt parallel

## 1.0.3 — 11. August 2026

- Build der Android-Datei fuer Releases repariert

## 1.0.2 — 11. August 2026

- Android-APK liegt jetzt bei den Releases

## 1.0.1 — 11. August 2026

- Versionsnummer auf 1.0.1 gehoben

## 1.0.0 — 10. August 2026

- Erste Fassung von ELFIX
