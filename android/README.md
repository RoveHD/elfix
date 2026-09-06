# Elflix Android / Android TV

This is the native Android companion app for Elflix. It intentionally does not try to run Electron on Android.

## Backend

- Native Media3 player for direct HLS/MP4 sources on phones and Android TV, with
  quality, audio/subtitle tracks, hoster selection, episodes and autoplay.
- Shared desktop source resolution, bounded JavaScript-host observation and intro
  learning. Watchparty commands wait for loading and seeking before acknowledging.
- OkHttp transport obtains WebView cookies for each destination, including redirects.
- Android `WebView`
- persistent WebView cookies/storage handled by the system WebView profile
- `WebChromeClient` custom-view fullscreen for HTML5 video
- `WebViewClient.shouldInterceptRequest` for lightweight ad/tracker blocking
- `WebChromeClient.onCreateWindow` returns `false` to block popup windows by default

Direct playback opens for episode and movie pages. If no source can be resolved,
the source menu offers retry and an explicit provider-page fallback. A new title
selection returns to direct playback. Leaving the app pauses playback.

Local debug build (installs separately from release):
`gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug -PelfixFassung=1.91.9-direkt -PelfixFassungNummer=19109`

The isolated device test `DirektSpielerGeraeteTest` uses a local media server and
does not start provider sessions or join a Watchparty. It tests real decoding,
pending/superseded commands, seek completion, media keys, focus and background pause.
Its MP4/HLS test accepts `-e mediaBase http://127.0.0.1:8877` with an HTTP server
serving `probe.mp4`, `probe.m3u8` and the playlist's segments (duration at least
120 seconds, HTTP range support). Forward the port with `adb reverse tcp:8877
tcp:8877`. Without this parameter the video test is explicitly skipped; the
self-contained PCM playback test still runs. Screenshots are saved in the debug
app's external files directory.

## TV behavior

- Same APK declares both launcher and Leanback launcher entries.
- Provider cards and search results are focusable buttons.
- D-pad focus scales cards and changes contrast.
- Back exits fullscreen first, then navigates WebView history, then exits the app.
- Provider switching pauses the previous WebView via JavaScript and `onPause()`.

## Shared provider model

Providers use the shared schema:

```json
{
  "id": "imdb",
  "name": "IMDb",
  "startUrl": "https://www.imdb.com",
  "searchUrl": "https://www.imdb.com/find/?q={query}",
  "logo": "IM",
  "enabled": true,
  "adblockEnabled": true,
  "sortOrder": 0
}
```

Desktop normalizes the same shape in `StreamingBrowserElectron/shared/provider-model.js`.
Android ships defaults in `app/src/main/assets/providers.json`.

## Shared core

Business logic is not reimplemented here. `Kern.java` runs the desktop app's own
JavaScript modules in an invisible `WebView`; `app/build.gradle` copies them from
`StreamingBrowserElectron/{src,shared}` at build time (list `kernModule`). A new
shared module has to be added to that list or it is missing at runtime.

- Call: `kern.rufe("modul.funktion", Kern.args(...), callback)`
- `fetch` is routed through Java (`Bruecke.netzStart`) because the core page has
  its own origin and would otherwise be blocked by CORS, and because the
  provider's session cookies live on the Java side.
- Android-only wiring lives in `assets/kern/eigen/*.js`. Rules do not.

## Start page

The phone start page mirrors the desktop one and is built from the same data:

- hero with artwork, episode line, real progress and actions, rotating through
  the five most recent continue entries
- rows for new episodes, continue watching (private and watchparty), watchlist
  and library
- recommendation rows ("Neu bei deinen Anbietern", "Empfohlen fuer dich",
  "Anime/Serien/Filme fuer dich") with the reason sentence the engine produced
- "Mehr anzeigen" opens a discovery page per kind that keeps loading while you
  scroll

The recommendations are computed by `empfehlungslauf.js` inside the core, so the
ranking, the thresholds and the reasons are the desktop's. `Empfehlungen.java`
only passes providers and the library in and holds the answers; the taste cache
is read from an intercepted URL (`Kern.DATEI_WIRT`) and written back in chunks,
because the JS/Java bridge carries every value as one single string.

## Build

Use JDK 21 and configure the Android SDK in `local.properties` or
`ANDROID_HOME`. The repository includes the Gradle wrapper:

```powershell
cd android
.\gradlew.bat :app:assembleDebug -PelfixFassung=1.91.9-direkt -PelfixFassungNummer=19109
```

Expected APK path:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Nächste Folge und Autoplay nachvollziehen

Was der Player misst und was die Leiste daraus macht, steht im Protokoll. Alle
Zeilen tragen `FOLGE`:

```bash
adb logcat -c && adb logcat -s ELFIX | grep FOLGE
```

Was dort in welcher Reihenfolge kommen muss, wenn eine Folge läuft:

| Zeile | Bedeutung | Wenn sie fehlt |
| --- | --- | --- |
| `FOLGE seitendaten … finalSeason=N` | die Folgenseite wurde gelesen | ohne `finalSeason>0` gibt es nie eine nächste Folge |
| `FOLGE mess … 2626/2680s = 98% … nah=true` | der Messtakt sieht das Video | kein `<video>` erreichbar (Rahmen/Hoster) |
| `FOLGE abspielseite … = true` | die Adresse gilt als Wiedergabeseite | die Leiste bleibt ganz weg |
| `FOLGE lage … finalSeason=N` | womit die geteilte Regel rechnet | steht hier 0, kommt kein Ziel |
| `FOLGE ziel …` | die ermittelte nächste Folge | `keine naechste Folge` = die Regel gibt nichts her |
| `FOLGE leiste sichtbar=true knopf=true` | was zu sehen sein müsste | `knopf=false` bei `nah=true` heißt: kein Ziel |
| `FOLGE zaehler an/abgelaufen/abgebrochen` | der Fünf-Sekunden-Zähler | mit Grund, wenn er nicht anläuft |

`FOLGE leiste` wird nur bei Änderung geschrieben, `FOLGE mess` in jedem
Fünf-Sekunden-Takt.
