# Filler-Kennzeichnung in der Folgenauswahl

ELFIX zeigt bekannte Episoden als **Manga-Canon**, **Filler**, **Canon / Filler**
oder **Anime-Canon**. Die Kennzeichnung erscheint im Desktop-Player sowie in
der Serienübersicht und im Player auf Android und Android TV. Sie bleibt auch
bei geschützten Folgentiteln sichtbar und verändert weder Wiedergabe noch
Autoplay oder Gesehen-Markierungen.

## Quelle ohne Anmeldung

Die Daten stammen aus den öffentlichen Episodentabellen von
[AnimeFillerList](https://www.animefillerlist.com/shows). Weder Konto noch
API-Schlüssel oder ein laufender ELFIX-Relay sind erforderlich.

AnimeFillerList stellt keine hier verifizierte offizielle JSON-API bereit. Der
geprüfte öffentliche Drittanbieter-Wrapper war nicht erreichbar. Deshalb liest
`StreamingBrowserElectron/src/anime-filler.js` die Originaltabellen direkt und
stellt beiden Apps dieselbe interne Schnittstelle zur Verfügung. Es werden nur
der Serienindex und die passende Serientabelle angefragt, keine Skripte der
Website ausgeführt. Die Quelle wird an den Kennzeichnungen genannt.

## Zuordnung und Laden

- Anime-URLs werden anhand von `/anime/stream/` erkannt. Andere Aufrufer dürfen
  `art: "anime"` nur bei bereits bestätigter Anime-Zuordnung übergeben.
- Vollständige Serientitel haben Vorrang vor alternativen Namen. Remakes,
  Fortsetzungen und mehrdeutige Treffer werden nicht geraten.
- AnimeFillerList nummeriert fortlaufend; Anbieter starten pro Staffel oft neu.
  Ab Staffel 2 braucht die Übertragung auf andere Folgen zwei übereinstimmende
  englische Folgentitel mit demselben Nummernversatz. Einzelne exakt gefundene
  Titel können separat zugeordnet werden. Filme unter Staffel 0 bleiben außen vor.
- Die deutschen Anbietertitel bleiben erhalten. Englische Titel werden nur
  zusätzlich und unsichtbar für den Abgleich gelesen.
- Fehlende Daten bedeuten unbekannt. Es gibt keine automatische Canon-Annahme.
- Die Folgenauswahl ist sofort bedienbar; Labels werden nachgeladen. Ein
  Staffel- oder Titelwechsel darf keinen alten Nachtrag auf neue Folgen anwenden.
- Antworten werden einen Tag lokal gespeichert. Bei Ausfällen sind vorhandene
  Daten höchstens 30 Tage weiter nutzbar; fehlgeschlagene Abrufe haben fünf Minuten
  Pause. Abrufe haben ein Zeitlimit und eine maximale Antwortgröße von 2 MiB.

## Prüfung

Die Node-Suite `animefillertest` deckt Parser, Kategorien, Titelabgleich,
Staffelversatz, fehlende Daten, Cache, parallele Abrufe und Ausfälle ab.
`uebersichttest` prüft die getrennte Extraktion deutscher und englischer Titel.
Android-Parser und Cache-Route laufen mit `:app:testDebugUnitTest` (JDK 21).
`electron tests/filler-electrontest.js` prüft die echte Desktop-Ansicht samt
sicherer Preload-Brücke, Labels, unbekannten Folgen, Fokus und Scrollposition.

Live geprüft am 13.09.2026: Naruto, Naruto Shippuden, One Piece und Boruto.
