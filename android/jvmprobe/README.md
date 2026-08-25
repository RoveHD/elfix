# Die Java-Pruefungen ohne Android-SDK laufen lassen

`android/app/src/test` sind gewoehnliche JUnit-Tests: reine Rechnung, kein
Geraet. Gradle laesst sie mit `./gradlew :app:test` laufen - das braucht aber
das Android-SDK, und das gibt es nicht ueberall (und in manchen Netzen ist
`dl.google.com` schlicht gesperrt).

`lauf.sh` daneben laesst dieselben Tests mit `javac` und `java` laufen. Es holt
sich vier Bibliotheken aus Maven Central, uebersetzt die App gegen einen
Android-Rumpf und startet JUnit. Was dabei herauskommt, ist zweierlei:

1. **Ein vollstaendiger Uebersetzungslauf der App.** `MainActivity.java` hat
   neuntausend Zeilen; ein Tippfehler darin faellt sonst erst im
   Release-Bau auf, also nach zehn Minuten Wartezeit auf einem fremden Rechner.
2. **Die Unit-Tests selbst**, mit denselben Klassen, die Gradle uebersetzt.

## Was es nicht ist

Kein Ersatz fuer den Bau. Ressourcen werden nicht verarbeitet (`R.java`
entsteht hier als Rumpf aus den Dateinamen unter `res/`), `androidx.webkit`
und `androidx.core` stehen als Rumpf da, und Lint laeuft gar nicht. Ein
gruener Lauf sagt: *es uebersetzt und die Rechnung stimmt*. Er sagt nicht,
dass die APK baut.

Und er sagt erst recht nichts darueber, wie sich die App auf einem Geraet
verhaelt. Alles, was einen Bildschirm, einen WebView oder eine Fernbedienung
braucht, faellt hier heraus - das gehoert auf ein echtes Telefon und einen
echten Fernseher.

## Aufruf

    android/jvmprobe/lauf.sh

Die Bibliotheken landen unter `~/.cache/elfix-jvmprobe` und werden beim
zweiten Lauf nicht noch einmal geholt.
