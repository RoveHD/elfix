# Elflix Android / Android TV

This is the native Android companion app for Elflix. It intentionally does not try to run Electron on Android.

## Backend

- Android `WebView`
- persistent WebView cookies/storage handled by the system WebView profile
- `WebChromeClient` custom-view fullscreen for HTML5 video
- `WebViewClient.shouldInterceptRequest` for lightweight ad/tracker blocking
- `WebChromeClient.onCreateWindow` returns `false` to block popup windows by default

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

This workspace currently does not have Android SDK/Gradle tools installed in `PATH`.
Once Android Studio or the Android command-line tools are installed:

```powershell
cd android
gradle :app:assembleDebug
```

Expected APK path:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
