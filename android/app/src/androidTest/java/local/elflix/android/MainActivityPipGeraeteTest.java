package local.elflix.android;

import static org.junit.Assert.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.view.KeyEvent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real MainActivity lifecycle and native PiP, using only an original local test video. */
@RunWith(AndroidJUnit4.class)
public class MainActivityPipGeraeteTest {
    private static Object lesen(Object ziel, String name) throws Exception {
        Field feld = ziel.getClass().getDeclaredField(name);
        feld.setAccessible(true);
        return feld.get(ziel);
    }
    private static void schreiben(Object ziel, String name, Object wert) throws Exception {
        Field feld = ziel.getClass().getDeclaredField(name);
        feld.setAccessible(true);
        feld.set(ziel, wert);
    }
    private static void rufen(Object ziel, String name) throws Exception {
        Method methode = ziel.getClass().getDeclaredMethod(name);
        methode.setAccessible(true);
        methode.invoke(ziel);
    }
    private static void pipAutomatik(MainActivity activity, boolean laeuft) {
        try {
            Method methode = MainActivity.class.getDeclaredMethod("direktPipAutomatikSetzen", boolean.class);
            methode.setAccessible(true);
            methode.invoke(activity, laeuft);
        } catch (Exception fehler) { throw new AssertionError(fehler); }
    }
    private static void warten(java.util.function.BooleanSupplier zustand) throws Exception {
        long ende = System.currentTimeMillis() + 15000;
        while (!zustand.getAsBoolean() && System.currentTimeMillis() < ende) Thread.sleep(100);
        assertTrue("Erwarteter PiP-Zustand fehlt", zustand.getAsBoolean());
    }

    @Test public void echtesMiniFensterSpieltWeiterUndKehrtZumPlayerZurueck() throws Exception {
        String base = InstrumentationRegistry.getArguments().getString("mediaBase");
        Assume.assumeTrue("Lokaler Originalvideo-Server erforderlich", base != null);
        AtomicReference<DirektSpieler> player = new AtomicReference<>();
        AtomicReference<MainActivity> activity = new AtomicReference<>();
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            AtomicBoolean bereit = new AtomicBoolean();
            warten(() -> { scenario.onActivity(a -> {
                try { bereit.set(((Kern) lesen(a, "kern")).istBereit()); }
                catch (Exception e) { throw new AssertionError(e); }
            }); return bereit.get(); });
            scenario.onActivity(a -> {
                Assume.assumeFalse(DirektSpieler.istFernseher(a.getResources().getConfiguration()));
                Assume.assumeTrue(a.getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE));
                try {
                    activity.set(a);
                    Provider provider = new Provider();
                    provider.id = "pip-fixture";
                    provider.name = "Lokales Testvideo";
                    provider.startUrl = base;
                    // Keep production MainActivity, wrapper and player. Only provider resolution
                    // is replaced by the local media fixture, without adding production test hooks.
                    DirektWiedergabe wiedergabe = new DirektWiedergabe(a, (Kern) lesen(a, "kern"), provider,
                        base + "/pip-fixture-page", "PiP-Gerätetest", 0, 0, 0, "", "",
                        new DirektWiedergabe.Umgebung() {
                            public void geschlossen() { }
                            public void browser(Provider p, String u) { }
                            public void stand(Provider p, String u, JSONObject s, JSONObject m) { }
                            public void live(JSONObject s, String aktion) { }
                            public void bereit(String u) { }
                            public void wiedergabe(boolean laeuft) { pipAutomatik(a, laeuft); }
                            public boolean darfAutoplay() { return false; }
                            public void marke(java.util.function.Consumer<JSONObject> fertig) { fertig.accept(null); }
                            public void sprung(double von, double nach) { }
                            public boolean inRunde() { return false; }
                        });
                    schreiben(wiedergabe, "auftrag", ((Integer) lesen(wiedergabe, "auftrag")) + 1);
                    rufen(wiedergabe, "seiteFreigeben");
                    schreiben(a, "direktWiedergabe", wiedergabe);
                    DirektSpieler spieler = (DirektSpieler) lesen(wiedergabe, "spieler");
                    player.set(spieler);
                    spieler.quelle(base + "/watchparty-fixture.mp4", "datei", Collections.emptyMap(), 0);
                } catch (Exception e) { throw new AssertionError(e); }
            });
            warten(() -> { scenario.onActivity(a -> bereit.set(player.get().laeuftFuerPip())); return bereit.get(); });
            UiDevice device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            assertTrue("Home kann injiziert werden", device.pressHome());
            warten(() -> activity.get().isInPictureInPictureMode());
            AtomicReference<Double> start = new AtomicReference<>();
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> start.set(player.get().position()));
            Thread.sleep(1500);
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                assertTrue("Native Wiedergabe läuft im Mini-Fenster weiter", player.get().laeuftFuerPip());
                assertTrue("Videoposition schreitet trotz onPause fort", player.get().position() > start.get() + .5);
            });
            // onNewIntent stores this intent. Preserve the launch identity so
            // ActivityScenario still observes subsequent lifecycle events.
            // Replace Scenario's initial CLEAR_TASK flags: returning must reuse
            // the running player rather than start a fresh activity/task.
            Intent zurueck = new Intent(activity.get().getIntent())
                .setFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_NEW_TASK);
            InstrumentationRegistry.getInstrumentation().getTargetContext().startActivity(zurueck);
            warten(() -> !activity.get().isInPictureInPictureMode());
            scenario.onActivity(a -> {
                assertSame("Rückkehr nutzt denselben Player-Bildschirm", activity.get(), a);
                assertTrue("Rückkehr behält die Wiedergabe", player.get().laeuftFuerPip());
                a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE));
                assertFalse(player.get().laeuftFuerPip());
                pipAutomatik(a, false);
                // Explicitly finish the returned activity before Scenario cleanup.
            });
            assertTrue("Home kann auch bei pausiertem Player gesendet werden", device.pressHome());
            Thread.sleep(1000);
            assertFalse("Ein pausierter Player darf nicht automatisch ins Mini-Fenster gehen",
                activity.get().isInPictureInPictureMode());
            scenario.onActivity(a -> a.finish());
        }
    }
}
