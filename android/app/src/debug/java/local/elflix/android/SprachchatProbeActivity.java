package local.elflix.android;

import android.app.Activity;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.FrameLayout;

/** Isolierte Sprach-WebView ohne Provider, Relay-Verbindung oder gespeicherte Nutzerdaten. */
public final class SprachchatProbeActivity extends Activity {
    Sprachchat sprachchat;
    private String prefsName;

    @Override public SharedPreferences getSharedPreferences(String name, int mode) {
        return super.getSharedPreferences(prefsName == null ? name : prefsName, mode);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(new FrameLayout(this));
        prefsName = "voice-probe-" + java.util.UUID.randomUUID();
        Context isolated = new ContextWrapper(this) {
            @Override public Context getApplicationContext() { return this; }
            @Override public SharedPreferences getSharedPreferences(String name, int mode) {
                return getBaseContext().getSharedPreferences(prefsName, mode);
            }
        };
        isolated.getSharedPreferences("elflix_watchparty", MODE_PRIVATE).edit()
            .putBoolean("enabled", !getIntent().getBooleanExtra("settings", false))
            .putString("rooms", getIntent().getBooleanExtra("settings", false) ? "[]" : "[\"voice-probe\"]")
            .putString("deviceName", "Sprachchat-Probe").apply();
        Watchparty party = new Watchparty(isolated, null, () -> {});
        party.ereignis("watchparty:status", "{\"connected\":true,\"rooms\":[{\"room\":\"voice-probe\",\"connected\":true}]}");
        sprachchat = new Sprachchat(this, party);
        if (getIntent().getBooleanExtra("settings", false)) sprachchat.einstellungenOeffnen();
        else sprachchat.oeffnen("voice-probe");
    }

    @Override protected void onDestroy() {
        if (sprachchat != null) sprachchat.schliessen();
        if (prefsName != null) deleteSharedPreferences(prefsName);
        super.onDestroy();
    }
}
