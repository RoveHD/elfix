# Elflix

Elflix ist ein kompakter Streaming-Browser fuer Desktop und Android/Android TV. Die App buendelt konfigurierbare Anbieter, globale Direktsuche, Favoriten, Anbieter-Wechsel, Adblock-/Popup-Blocking und eine moderne Startseite.

## Features

- Windows-App mit Chromium-Webviews und installierbarem Setup
- Android/Android-TV-App mit Touch-, D-Pad- und Mausmodus
- Anbieter-Verwaltung fuer AniWorld, S.to, Filmo und eigene Provider
- Globale Suche mit Anbieter-spezifischen Such-URLs und Schreibweisen wie `spiderman`/`spider-man`
- Favoriten mit Anbieter-spezifischer Bild-Erkennung und Fortschrittslogik
- Automatische Updates ueber GitHub Releases fuer die installierte Windows-Version
- Settings mit Version, Update-Status und Fortschrittsbalken

## Windows Build

```powershell
cd StreamingBrowserElectron
npm ci
npm run dist
```

Die gebauten Dateien liegen danach unter:

```text
StreamingBrowserElectron/dist/
```

Der Installer heisst nach aktuellem Schema:

```text
Elflix-Setup-<version>-x64.exe
```

Die portable Variante heisst:

```text
Elflix-Portable-<version>-x64.exe
```

## Releases und Auto-Updates

Elflix nutzt `electron-updater` mit GitHub Releases:

```text
https://github.com/RoveHD/elfix/releases
```

Ein Release wird durch einen Tag wie `v0.2.0` oder manuell ueber den GitHub Actions Workflow gebaut. Fuer automatische Updates muessen die vom Workflow erzeugten Assets im GitHub Release liegen, besonders:

```text
Elflix-Setup-<version>-x64.exe
Elflix-Setup-<version>-x64.exe.blockmap
latest.yml
```

Die installierte App prueft automatisch auf Updates. In den Einstellungen gibt es zusaetzlich den Bereich `Updates & Version` mit installierter Version, Update-Quelle, Status und Fortschritt.

## Windows Defender / SmartScreen

Damit Windows keine SmartScreen-Warnung fuer neue Installer zeigt, muss der Release-Build mit einem gueltigen Code-Signing-Zertifikat signiert werden. Der Workflow ist fuer Signing-Secrets vorbereitet:

```text
CSC_LINK
CSC_KEY_PASSWORD
```

Ohne echtes Code-Signing-Zertifikat kann eine Warnung bei unbekannten Downloads nicht technisch garantiert verhindert werden.

## Android Build

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

Die Debug-APK liegt danach unter:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Entwicklung

```powershell
cd StreamingBrowserElectron
npm start
```

Tests/Syntaxchecks:

```powershell
cd StreamingBrowserElectron
npm run test
```
