package local.elflix.android;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.util.Collections;

/** Isolierter Audio-only Client. Provider-WebViews erhalten niemals Capture-Rechte. */
final class Sprachchat {
    private static final int MIC_REQUEST = 820;
    private final Activity activity;
    private final Watchparty watchparty;
    interface Umgebung {
        void duck(boolean aktiv);
        default void sitzung(boolean aktiv) { }
    }
    private final Umgebung umgebung;
    private FrameLayout platz;
    private WebView view;
    private String raum = "";
    private String mikrofonAnfrage;
    private boolean vordergrund = true;
    private boolean sichtbar;
    private boolean mikrofonBewilligt;
    private boolean dienstAktiv;
    private boolean sitzungAktiv;
    private int generation;
    private boolean settingsMode;

    Sprachchat(Activity activity, Watchparty watchparty) {
        this(activity, watchparty, aktiv -> {});
    }

    Sprachchat(Activity activity, Watchparty watchparty, Umgebung umgebung) {
        this.activity = activity;
        this.watchparty = watchparty;
        this.umgebung = umgebung;
    }

    @SuppressLint("SetJavaScriptEnabled")
    void oeffnen(String code) {
        oeffnen(code, false);
    }

    void einstellungenOeffnen() {
        String code = view != null ? raum : watchparty.raumcodes().isEmpty() ? "" : watchparty.raumcodes().get(0);
        oeffnen(code, true);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void oeffnen(String code, boolean einstellungen) {
        if (code == null || (!einstellungen && !watchparty.raumcodes().contains(code))) {
            Toast.makeText(activity, "Bitte zuerst einen Sprachraum einrichten.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (view != null && code.equals(raum)) { settingsMode = einstellungen; zeigen(); kontextAktualisieren(); return; }
        schliessen();
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Toast.makeText(activity, "Für den sicheren Sprachchat bitte Android System WebView aktualisieren.", Toast.LENGTH_LONG).show();
            return;
        }
        raum = code;
        settingsMode = einstellungen;
        platz = new FrameLayout(activity);
        platz.setBackgroundColor(android.graphics.Color.rgb(12, 16, 24));
        view = new WebView(activity);
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(activity)).build();
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView web, WebResourceRequest request) {
                if (request == null || !SprachchatSicherheit.assetErlaubt(request.getUrl().toString())) {
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                        Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView web, WebResourceRequest request) {
                return request == null || !SprachchatSicherheit.SEITE.equals(request.getUrl().toString());
            }
            @Override public void onPageFinished(WebView web, String url) {
                if (!SprachchatSicherheit.SEITE.equals(url)) { schliessen(); return; }
                kontextAktualisieren();
            }
            @Override public boolean onRenderProcessGone(WebView web, android.webkit.RenderProcessGoneDetail detail) {
                schliessen();
                Toast.makeText(activity, "Sprachchat beendet. Bitte erneut öffnen und beitreten.", Toast.LENGTH_LONG).show();
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                boolean erlaubt = view != null && SprachchatSicherheit.SEITE.equals(view.getUrl())
                    && dienstAktiv && mikrofonBewilligt
                    && activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
                if (SprachchatSicherheit.audioErlaubt(request.getOrigin().toString(), request.getResources(), erlaubt)) {
                    request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else request.deny();
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) WebViewCompat.addWebMessageListener(view, "ElfixVoiceNative",
            Collections.singleton(SprachchatSicherheit.ORIGIN), (web, message, origin, topFrame, reply) -> {
                if (web != view || !topFrame || !SprachchatSicherheit.originErlaubt(origin.toString())
                    || !SprachchatSicherheit.SEITE.equals(web.getUrl())) return;
                String data = message.getData();
                if (data == null || data.length() > 65536) return;
                try { befehl(new JSONObject(data)); }
                catch (Exception falsch) { /* Ungueltige Nachrichten sind keine Hostbefehle. */ }
            });
        platz.addView(view, new FrameLayout.LayoutParams(-1, -1));
        ((ViewGroup) activity.getWindow().getDecorView()).addView(platz, new ViewGroup.LayoutParams(-1, -1));
        zeigen();
        view.loadUrl(SprachchatSicherheit.SEITE);
    }

    private void befehl(JSONObject befehl) throws org.json.JSONException {
        String id = befehl.optString("id");
        switch (befehl.optString("method")) {
            case "context": antwort(id, kontext(), null); break;
            case "preferences":
                antwort(id, new JSONObject().put("inputDeviceId", activity.getSharedPreferences("elfix_sprachchat", Activity.MODE_PRIVATE)
                    .getString("inputDeviceId", "")), null);
                break;
            case "savePreferences":
                JSONObject prefs = befehl.optJSONObject("value");
                String device = prefs == null ? "" : prefs.optString("inputDeviceId", "");
                if (device.length() > 512) { antwort(id, false, "Ungültiges Mikrofon"); break; }
                activity.getSharedPreferences("elfix_sprachchat", Activity.MODE_PRIVATE).edit()
                    .putString("inputDeviceId", device).apply();
                antwort(id, true, null);
                break;
            case "microphone":
                if (!vordergrund || !sichtbar || mikrofonAnfrage != null) {
                    antwort(id, false, null); break;
                }
                mikrofonAnfrage = id;
                if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
                    || (Build.VERSION.SDK_INT >= 33
                        && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)) {
                    String[] permissions = Build.VERSION.SDK_INT >= 33
                        ? new String[] { Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS }
                        : new String[] { Manifest.permission.RECORD_AUDIO };
                    activity.requestPermissions(permissions, MIC_REQUEST);
                } else mikrofonStarten();
                break;
            case "capture":
                if (!befehl.optBoolean("value", false)) mikrofonStoppen();
                antwort(id, true, null);
                break;
            case "state":
                JSONObject state = befehl.optJSONObject("value");
                // Muted bleibt waehrend getUserMedia true; ein Peer-Update darf
                // die ausdruecklich gestartete Aufnahmeanfrage nicht abbrechen.
                // onMicrophone(false) liefert das tatsaechliche Track-Ende.
                if (state != null) {
                    boolean joined = state.optBoolean("joined", false);
                    if (joined && !sitzungAktiv) {
                        sitzungAktiv = true;
                        umgebung.sitzung(true);
                        if (!vordergrund) { schliessen(); return; }
                        dienstAnfordern(false);
                    } else if (!joined && sitzungAktiv) sitzungStoppen();
                }
                antwort(id, true, null);
                break;
            case "send":
                JSONObject nachricht = befehl.optJSONObject("value");
                String type = nachricht == null ? "" : nachricht.optString("type");
                if (!java.util.Arrays.asList("voicejoin", "voiceleave", "voicestate", "voicesignal").contains(type)) {
                    antwort(id, false, "Ungültiges Sprachchat-Signalling"); break;
                }
                if ("voiceleave".equals(type)) sitzungStoppen();
                WebView sender = view;
                watchparty.voiceSenden(raum, nachricht, (wert, fehler) -> {
                    if (view == sender) antwort(id, "true".equals(wert), fehler);
                });
                break;
            case "hide": antwort(id, true, null); verbergen(); break;
            case "duck": umgebung.duck(befehl.optBoolean("value", false)); antwort(id, true, null); break;
            case "close": antwort(id, true, null); schliessen(); break;
            default: antwort(id, false, "Unbekannter Sprachchat-Befehl");
        }
    }

    boolean berechtigungsAntwort(int requestCode) {
        if (requestCode != MIC_REQUEST) return false;
        if (mikrofonAnfrage != null) {
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) mikrofonStarten();
            else mikrofonFertig(false);
        }
        return true;
    }

    private void mikrofonStarten() {
        if (view == null || !vordergrund || !sichtbar) { mikrofonFertig(false); return; }
        if (mikrofonBewilligt && dienstAktiv) { mikrofonFertig(true); return; }
        dienstAnfordern(true);
    }

    private void dienstAnfordern(boolean mikrofon) {
        if (view == null || (!sitzungAktiv && !(mikrofon && mikrofonAnfrage != null))) { mikrofonFertig(false); return; }
        int lauf = generation;
        SprachchatDienst.beobachter = new SprachchatDienst.Beobachter() {
            @Override public int generation() { return lauf; }
            @Override public void bereit(boolean ok, boolean mitMikrofon) {
                if (view == null || generation != lauf) return;
                if (!ok) { schliessen(); return; }
                dienstAktiv = ok;
                if (mitMikrofon) {
                    if (mikrofonAnfrage == null || !vordergrund) { mikrofonStoppen(); return; }
                    mikrofonBewilligt = true;
                    mikrofonFertig(true);
                }
            }
            @Override public void aktion(String aktion) {
                if (SprachchatDienst.LEAVE.equals(aktion)) schliessen();
                else zustellen("action", "mute");
            }
            @Override public void beendet() { if (generation == lauf) schliessen(); }
        };
        Intent intent = new Intent(activity, SprachchatDienst.class)
            .putExtra("generation", lauf).putExtra("microphone", mikrofon).putExtra("playback", sitzungAktiv);
        try {
            if (dienstAktiv) activity.startService(intent);
            else if (vordergrund) activity.startForegroundService(intent);
            else schliessen();
        } catch (RuntimeException verweigert) { schliessen(); }
    }

    private void mikrofonFertig(boolean ok) {
        String id = mikrofonAnfrage;
        mikrofonAnfrage = null;
        if (id != null) antwort(id, ok, null);
    }

    private void mikrofonStoppen() {
        mikrofonBewilligt = false;
        mikrofonFertig(false);
        if (sitzungAktiv && dienstAktiv) dienstAnfordern(false);
        else if (!sitzungAktiv) dienstStoppen();
    }

    private void sitzungStoppen() {
        sitzungAktiv = false;
        mikrofonStoppen();
        umgebung.duck(false);
        umgebung.sitzung(false);
    }

    private void dienstStoppen() {
        dienstAktiv = false;
        SprachchatDienst.beobachter = null;
        activity.stopService(new Intent(activity, SprachchatDienst.class));
    }

    void hintergrund() {
        vordergrund = false;
        mikrofonFertig(false);
        zustellen("action", "background");
        // Bei verweigerten Benachrichtigungen fehlen Mute/Leave ausserhalb
        // der App. In diesem Fall endet Capture beim Appwechsel sofort.
        if (Build.VERSION.SDK_INT >= 33
            && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            zustellen("action", "mute");
        }
    }
    void pttLoslassen() { zustellen("action", "background"); }
    void pipModus(boolean inPip) { if (inPip && sichtbar && view != null) verbergen(); }

    void vordergrund() { vordergrund = true; kontextAktualisieren(); }

    void kontextAktualisieren() {
        if (view == null) return;
        if (!settingsMode && (!watchparty.raumcodes().contains(raum) || !watchparty.istEingeschaltet())) { schliessen(); return; }
        if (!watchparty.raumVerbunden(raum) && sitzungAktiv) { zustellen("action", "mute"); sitzungStoppen(); }
        zustellen("context", kontext());
    }

    void empfangen(JSONObject nachricht) {
        if (view != null && nachricht != null && raum.equals(nachricht.optString("room"))) zustellen("message", nachricht);
    }

    private JSONObject kontext() {
        JSONObject context = new JSONObject();
        try { context.put("room", raum).put("name", watchparty.geraetName())
            .put("connected", watchparty.raumVerbunden(raum)).put("settings", settingsMode); }
        catch (Exception ignoriert) { }
        return context;
    }

    private void antwort(String id, Object value, String error) {
        if (view == null) return;
        try { liefern(new JSONObject().put("id", id).put("value", value).put("error", error)); }
        catch (Exception ignoriert) { }
    }

    private void zustellen(String kind, Object value) {
        try { liefern(new JSONObject().put("kind", kind).put("value", value)); }
        catch (Exception ignoriert) { }
    }

    private void liefern(JSONObject event) {
        if (view != null) view.evaluateJavascript("window.ElfixVoiceAndroidDeliver && window.ElfixVoiceAndroidDeliver(" + event + ");", null);
    }

    private void zeigen() {
        sichtbar = true;
        platz.setVisibility(View.VISIBLE);
        ViewGroup.LayoutParams lp = platz.getLayoutParams();
        lp.width = -1; lp.height = -1; platz.setLayoutParams(lp);
        platz.bringToFront(); view.requestFocus();
    }

    private void verbergen() {
        sichtbar = false;
        // Weiter im View-Baum: kein WebView.onPause und keine globalen pauseTimers.
        platz.setVisibility(View.INVISIBLE);
        ViewGroup.LayoutParams lp = platz.getLayoutParams();
        lp.width = 1; lp.height = 1; platz.setLayoutParams(lp);
    }

    boolean zurueck() { if (!sichtbar || view == null) return false; verbergen(); return true; }
    boolean istSichtbar() { return sichtbar && view != null; }
    void wiederOeffnen() { if (view != null) zeigen(); }

    void schliessen() {
        generation++;
        sitzungStoppen();
        if (view == null) return;
        try { watchparty.voiceSenden(raum, new JSONObject().put("type", "voiceleave"), (wert, fehler) -> {}); }
        catch (Exception ignoriert) { }
        WebView alt = view;
        view = null;
        sichtbar = false;
        raum = "";
        ((ViewGroup) platz.getParent()).removeView(platz);
        platz.removeAllViews(); platz = null;
        alt.stopLoading(); alt.destroy();
    }
}
