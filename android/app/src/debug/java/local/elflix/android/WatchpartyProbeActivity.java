package local.elflix.android;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONObject;

/**
 * Debug-only endpoint for the physical PC/phone watchparty run.
 *
 * The phone joins the relay from the copied watchparty bridge itself.  The
 * coordinator is deliberately observation-only: it receives timestamped
 * player samples over adb reverse, while relay controls still travel through
 * WatchpartyRaeume and are judged by steuerungPruefen in the APK Kern.
 */
public final class WatchpartyProbeActivity extends Activity {
    private static final String TAG = "ELFIX-WatchpartyProbe";
    Kern kern;
    DirektSpieler spieler;
    private String room, key, mediaUrl, telemetryUrl;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable sample = new Runnable() { @Override public void run() { senden("sample"); handler.postDelayed(this, 250); } };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        Intent intent = getIntent();
        room = intent.getStringExtra("room"); key = intent.getStringExtra("key");
        mediaUrl = intent.getStringExtra("mediaUrl"); telemetryUrl = intent.getStringExtra("telemetryUrl");
        final String serverUrl = intent.getStringExtra("serverUrl");
        if (room == null) room = "geraeteprobe";
        if (key == null) key = "film:watchparty-geraeteprobe";
        kern = new Kern(this, this::kernEreignis);
        kern.starten();
        spieler = new DirektSpieler(this, kern, new DirektSpieler.Umgebung() {
            public void schliessen() { finish(); }
            public void fassungen() { }
            public void hoster() { }
            public void folgen() { }
            public void naechste() { }
            public void stand(JSONObject wert) { senden("stand"); }
            public void live(JSONObject wert, String aktion) {
                senden("live-" + aktion);
                if (aktion != null && !aktion.isEmpty()) action(aktion);
            }
            public void bereit() { senden("bereit"); }
            public boolean darfAutoplay() { return false; }
            public boolean inRunde() { return true; }
            public void marke(java.util.function.Consumer<JSONObject> fertig) { fertig.accept(null); }
            public void sprung(double von, double nach) { }
        });
        setContentView(spieler.ansicht);
        kern.wennBereit(() -> {
            try {
                JSONObject config = new JSONObject().put("enabled", true).put("serverUrl", serverUrl)
                    .put("rooms", new org.json.JSONArray().put(room)).put("deviceName", "Android Geraeteprobe")
                    .put("deviceId", "android-geraeteprobe");
                kern.rufe("watchparty-bruecke.konfigurieren", Kern.args(config), (wert, fehler) -> {
                    if (fehler != null) Log.e(TAG, "Bridge config: " + fehler);
                    // The PC shares before this activity is launched. Joining is retried once
                    // after the websocket has obtained the room state.
                    handler.postDelayed(() -> beitreten(), 800);
                    handler.postDelayed(() -> beitreten(), 1800);
                });
                if (mediaUrl != null && !mediaUrl.isEmpty()) spieler.quelle(mediaUrl, "datei", Collections.emptyMap(), 0);
            } catch (Exception failure) { Log.e(TAG, "Probe setup", failure); }
        });
        handler.postDelayed(sample, 250);
    }

    private void beitreten() { kern.rufe("watchparty-bruecke.beitreten", Kern.args(key, room), (wert, fehler) -> senden("join")); }

    private void kernEreignis(String name, String json) {
        if ("watchparty:steuerung".equals(name)) {
            try { steuerung(new JSONObject(json)); } catch (Exception error) { Log.e(TAG, "control", error); }
        }
        if ("watchparty:status".equals(name) || "watchparty:zustand".equals(name)) senden(name);
    }

    private void steuerung(JSONObject nachricht) throws Exception {
        JSONObject lage = new JSONObject().put("binHost", false).put("hostId", "")
            .put("nativ", true).put("gleicheAdresse", true).put("season", 0).put("episode", 0);
        try { lage.put("spielstand", spieler.liveStand()); } catch (Exception ignored) { }
        kern.rufe("watchparty-bruecke.steuerungPruefen", Kern.args(nachricht, lage), (wert, fehler) -> {
            if (fehler != null || wert == null) { Log.e(TAG, "control judgement: " + fehler); return; }
            try {
                JSONObject verdict = new JSONObject(wert);
                if (!"nichts".equals(verdict.optString("tun")))
                    spieler.steuern(verdict, () -> {
                        String action = nachricht.optString("action");
                        // syncprepare is a barrier, not an acknowledgement of
                        // receipt. Media3 calls this only after its exact seek
                        // has settled; only then may the real relay emit syncstart.
                        if ("syncprepare".equals(action)) kern.rufe("watchparty-bruecke.bereitZumStart",
                            Kern.args(key, room, nachricht.optString("syncId")), (ignored, failure) -> { });
                        senden("applied-" + action);
                    });
            } catch (Exception error) { Log.e(TAG, "control apply", error); }
        });
    }

    /** `adb shell am start -n .../.WatchpartyProbeActivity --es command pause` sends a real relay action. */
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String command = intent.getStringExtra("command");
        if ("pause".equals(command) || "play".equals(command)) spieler.taste(new android.view.KeyEvent(
            android.view.KeyEvent.ACTION_DOWN, "pause".equals(command)
                ? android.view.KeyEvent.KEYCODE_MEDIA_PAUSE : android.view.KeyEvent.KEYCODE_MEDIA_PLAY));
    }
    private void action(String action) {
        double position = spieler.position();
        String message = "__elfix:wp:" + action + ":" + String.format(java.util.Locale.ROOT, "%.3f", position);
        kern.rufe("watchparty-bruecke.meldungSenden", Kern.args(message, key, "https://probe.invalid/watchparty", room),
            (wert, fehler) -> senden("sent-" + action));
    }

    private void senden(String kind) {
        if (telemetryUrl == null || telemetryUrl.isEmpty() || spieler == null) return;
        final JSONObject value = new JSONObject();
        try {
            JSONObject live = spieler.liveStand();
            value.put("device", "android").put("kind", kind).put("at", System.currentTimeMillis())
                .put("position", spieler.position()).put("paused", live.optBoolean("paused"))
                .put("duration", live.optDouble("duration")).put("puffert", live.optBoolean("puffert"));
            if (live.has("frameTime")) value.put("frameTime", live.getDouble("frameTime"));
            if ("sample".equals(kind) && kern.istBereit()) {
                live.put("url", "https://probe.invalid/watchparty");
                live.put("playerSessionId", "android-physical-player");
                kern.rufe("watchparty-bruecke.meldeStand", Kern.args(key, live, room), (ignored, failure) -> {});
            }
        }
        catch (Exception ignored) { return; }
        new Thread(() -> {
            try {
                HttpURLConnection connection = (HttpURLConnection) new URL(telemetryUrl).openConnection();
                connection.setConnectTimeout(1000); connection.setReadTimeout(1000); connection.setRequestMethod("POST"); connection.setDoOutput(true);
                byte[] body = value.toString().getBytes(StandardCharsets.UTF_8);
                connection.setFixedLengthStreamingMode(body.length); connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream output = connection.getOutputStream()) { output.write(body); }
                connection.getResponseCode(); connection.disconnect();
            } catch (Exception ignored) { }
        }, "watchparty-probe-telemetry").start();
    }

    @Override public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        return spieler != null && spieler.taste(event) || super.dispatchKeyEvent(event);
    }
    @Override protected void onPause() { super.onPause(); if (spieler != null) spieler.pause(); }
    @Override protected void onResume() { super.onResume(); if (spieler != null) spieler.vordergrund(); }
    @Override protected void onDestroy() { handler.removeCallbacksAndMessages(null); if (spieler != null) spieler.schliessen(); if (kern != null) kern.beenden(); super.onDestroy(); }
}
