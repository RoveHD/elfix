package local.elflix.android;

import android.app.Activity;
import android.os.Bundle;
import org.json.JSONObject;

/** Isolated test surface: no provider navigation, account or relay startup. */
public class DirektProbeActivity extends Activity {
    Kern kern;
    DirektSpieler spieler;
    volatile JSONObject stand = new JSONObject();
    volatile JSONObject marke;
    volatile int spruenge;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        kern = new Kern(this, null);
        kern.starten();
        spieler = new DirektSpieler(this, kern, new DirektSpieler.Umgebung() {
            public void schliessen() { finish(); }
            public void quellen() { }
            public void folgen() { }
            public void naechste() { }
            public void stand(JSONObject wert) { stand = wert; }
            public void live(JSONObject wert, String aktion) { }
            public void bereit() { }
            public boolean darfAutoplay() { return true; }
            public void marke(java.util.function.Consumer<JSONObject> fertig) { fertig.accept(marke); }
            public void sprung(double von, double nach) { spruenge++; }
        });
        setContentView(spieler.ansicht);
    }
    @Override protected void onPause() { super.onPause(); if (spieler != null) spieler.pause(); }
    @Override protected void onResume() { super.onResume(); if (spieler != null) spieler.vordergrund(); }
    @Override public boolean dispatchKeyEvent(android.view.KeyEvent event) {
        return spieler != null && spieler.taste(event) || super.dispatchKeyEvent(event);
    }
    @Override protected void onDestroy() {
        if (spieler != null) spieler.schliessen();
        if (kern != null) kern.beenden();
        super.onDestroy();
    }
}
