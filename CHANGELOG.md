# Changelog

Alle Versionen von ELFIX, neueste zuerst. Die Eintraege stammen aus den
Release-Commits - was dort steht, ist auch tatsaechlich in der Version drin.

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
