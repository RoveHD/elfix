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
