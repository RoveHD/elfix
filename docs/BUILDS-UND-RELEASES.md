# Builds, Releases und Signierung

## Windows bauen

```powershell
cd StreamingBrowserElectron
npm ci
npm run dist
```

Die gebauten Dateien liegen danach unter `StreamingBrowserElectron/dist/`:

```text
ELFIX-Setup-<version>-x64.exe        der Installer
ELFIX-Portable-<version>-x64.exe     die portable Variante
```

## Android bauen

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

Die Debug-APK liegt danach unter
`android/app/build/outputs/apk/debug/app-debug.apk`.

Eine Release-APK — die einzige, die sich als Update installieren lässt —
braucht den Schlüssel:

```powershell
cd android
.\gradlew.bat :app:assembleRelease `
  "-PelfixKeystore=C:\Pfad\zu\elfix.jks" `
  "-PelfixKeystorePasswort=..." "-PelfixKeyAlias=elfix" "-PelfixKeyPasswort=..." `
  "-PelfixFassung=1.38.0" "-PelfixFassungNummer=13800"
```

## Releases und Auto-Updates

ELFIX nutzt `electron-updater` mit GitHub Releases:
<https://github.com/RoveHD/elfix/releases>

Ein Release wird durch einen Tag wie `v2.0.22` oder manuell über den
GitHub-Actions-Workflow *Release ELFIX* gebaut. Von Hand gestartet fragt der
Workflow nach einem Tag: bleibt das Feld leer, wird nur gebaut — steht ein Tag
darin, wird veröffentlicht, und der Tag entsteht dabei an dem Commit, auf dem
der Lauf startet. Das ist der Weg, wenn sich ein Tag lokal nicht pushen lässt.

Für automatische Updates müssen die vom Workflow erzeugten Assets im
GitHub-Release liegen, besonders:

```text
ELFIX-Setup-<version>-x64.exe
ELFIX-Setup-<version>-x64.exe.blockmap
latest.yml
```

Die installierte App prüft beim Start automatisch auf Updates. Wird eines
gefunden, lädt sie es, installiert es **still im Hintergrund** und startet
danach neu — der Installer zeigt keine Seiten und fragt nicht nach dem
Installationsort. Installiert wird immer nur für den angemeldeten Benutzer nach
`%LOCALAPPDATA%\Programs\ELFIX`. In den Einstellungen steht unter *Daten &
Updates* die installierte Version, die Update-Quelle, der Status und der
Fortschritt.

Der Ablauf für ein Release:

```powershell
cd StreamingBrowserElectron
npm test
npm run lint
# Version in package.json und package-lock.json setzen (nur über JSON, nie per Textersetzung)
npm ci --dry-run
git commit -am "Release ELFIX <version>"
git tag -a v<version> -m "Release ELFIX <version>"
git push origin main --follow-tags
```

## Testbau eines Zweigs

Ein Bau zum Ausprobieren, ohne Tag und ohne Release: **Actions → Testbau ELFIX →
Run workflow**.

Den Zweig wählst du dabei zweimal, und das ist Absicht. Oben steht GitHubs
eigene Auswahl (*Use workflow from*) — sie bestimmt, aus welchem Zweig die
Workflow-Datei kommt, und zeigt nur Zweige, auf denen es sie schon gibt. Das
Feld **Zweig** darunter bestimmt, was wirklich gebaut wird. Damit lässt sich
auch ein Zweig bauen, der den Workflow noch gar nicht hat: aus `main` starten,
Zweignamen eintragen. Bleibt das Feld leer, gilt die Auswahl von oben.

| Feld | Bedeutung |
| --- | --- |
| Zweig | Was gebaut wird. Leer = der oben ausgewählte |
| Ziel | `beide`, `windows` oder `android` |
| APK | `release` legt sich über die installierte App (braucht den Schlüssel), `debug` installiert daneben, `beide` baut beides |
| Prüfungen | Vorher `npm run lint`, `npm test` und die Java-Unit-Tests laufen lassen |

Die Dateien hängen danach als Artefakte am Lauf (vierzehn Tage, dann räumt
GitHub sie weg). Die Zusammenfassung des Laufs sagt, welche wofür ist.

**Windows.** Zwei Dateien. `ELFIX-Portable-*.exe` startet ohne Installation und
lässt eine vorhandene ELFIX in Ruhe; `ELFIX-Setup-*.exe` legt sich darüber.
Beide sind nicht signiert — SmartScreen meldet sich beim ersten Start. Die
Fassung bleibt die aus `package.json`: steht auf GitHub ein neueres Release,
holt der Testbau es sich beim Start von selbst und ist danach weg. Das ist
dasselbe Verhalten wie bei einer echten Installation.

**Android.** Die Release-APK ist mit demselben Schlüssel unterschrieben wie ein
echtes Release und legt sich deshalb über eine vorhandene ELFIX — Bestand,
Einstellungen und Geräteschlüssel bleiben stehen. Das ist die Fassung, mit der
sich ein echtes Update prüfen lässt. Die Debug-APK trägt die Kennung
`local.elflix.android.debug` und installiert sich daneben, mit eigenen Daten.

Die Fassung heißt `<version>-test.<laufnummer>`, der `versionCode` bleibt der der
Fassung aus `package.json`. Beides zusammen ist der Grund, warum ein Testbau
nichts kaputtmacht:

- Gleicher `versionCode` heißt, dass sich der Testbau über dieselbe Fassung
  legen lässt *und* kein späteres echtes Update blockiert — Android nimmt keine
  niedrigere Nummer über eine höhere.
- Der Zusatz `-test.42` macht den Testbau für die eigene Update-Suche *neuer*
  als das gleichnamige Release: ELFIX bietet dir nicht sofort an, ihn gegen
  2.0.22 zu tauschen. Ein echtes 2.0.23 oder 2.1.0 bietet es weiterhin an.

Umgekehrt gilt: eine schon installierte, **neuere** ELFIX nimmt eine Testbau-APK
nicht an (`INSTALL_FAILED_VERSION_DOWNGRADE`). Dann hilft nur Deinstallieren —
und dabei gehen die App-Daten mit.

## Windows Defender / SmartScreen

Damit Windows keine SmartScreen-Warnung für neue Installer zeigt, muss der
Release-Build mit einem gültigen Code-Signing-Zertifikat signiert werden. Der
Workflow ist für Signing-Secrets vorbereitet:

```text
CSC_LINK
CSC_KEY_PASSWORD
```

Ohne echtes Code-Signing-Zertifikat lässt sich eine Warnung bei unbekannten
Downloads technisch nicht garantiert verhindern.

## Android: Updates und der Unterschriftsschlüssel

Auch die APK aktualisiert sich selbst — aus denselben GitHub Releases wie der
Rechner. Beim Start sieht ELFIX nach (höchstens alle sechs Stunden), lädt eine
neuere Fassung im Hintergrund und fragt dann einmal. Installiert wird nie von
allein: der Paketinstaller von Android zeigt immer seinen eigenen Dialog, und
ELFIX braucht dafür einmalig die Erlaubnis „Unbekannte Apps installieren". In
den Einstellungen steht die Karte *ELFIX aktualisieren* mit Fassung, Stand und
einem Knopf, der sofort nachsieht.

Damit ein Update sich über die bestehende App legen kann, muss **jede** APK mit
demselben Schlüssel unterschrieben sein. Android verweigert sonst die
Installation (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`), und der einzige Ausweg wäre
Deinstallieren — mitsamt allem, was auf dem Gerät steht.

Der Schlüssel wird einmal erzeugt und liegt **nie im Repository**:

```powershell
keytool -genkeypair -v -keystore elfix.jks -alias elfix `
  -keyalg RSA -keysize 4096 -validity 10000
# Bewusst über WriteAllText und nicht über ">": Windows PowerShell bricht
# lange Zeilen bei der Umleitung an der Konsolenbreite um und schreibt UTF-16.
# Beides ist hier zwar verkraftbar - Convert.FromBase64String überliest
# Zeilenumbrüche -, aber eine Datei, die genau das enthält, was sie enthalten
# soll, erspart die Frage.
[IO.File]::WriteAllText("$PWD\elfix.jks.txt", [Convert]::ToBase64String([IO.File]::ReadAllBytes("elfix.jks")))
```

Der Inhalt von `elfix.jks.txt` und die drei Passwörter kommen als Secrets in das
Repository (*Settings → Secrets and variables → Actions*):

```text
ANDROID_KEYSTORE_BASE64     der Inhalt von elfix.jks.txt
ANDROID_KEYSTORE_PASSWORT   das Keystore-Passwort
ANDROID_KEY_ALIAS           elfix
ANDROID_KEY_PASSWORT        das Schlüssel-Passwort
```

Die `elfix.jks` selbst gut aufheben. Geht sie verloren, lässt sich **kein**
Update mehr ausliefern — dann hilft nur eine neue App und eine Neuinstallation
von Hand.

Ohne die Secrets baut der Workflow weiterhin eine Debug-APK und schreibt eine
Warnung in den Lauf. Die lässt sich installieren, aber nicht aktualisieren.

Die Fassung setzt der Workflow aus dem Tag: `v1.38.0` wird zu `versionName
1.38.0` und `versionCode 13800`. In `build.gradle` steht sie deshalb nicht mehr
fest.
