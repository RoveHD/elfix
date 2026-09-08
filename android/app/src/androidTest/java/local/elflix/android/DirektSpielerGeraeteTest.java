package local.elflix.android;

import static org.junit.Assert.*;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;
import androidx.media3.ui.PlayerView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DirektSpielerGeraeteTest {
    private static void warten(java.util.function.BooleanSupplier test) throws Exception {
        long ende = System.currentTimeMillis() + 30000;
        while (!test.getAsBoolean() && System.currentTimeMillis() < ende) Thread.sleep(100);
        assertTrue("Bedingung nach 30 Sekunden nicht erfüllt", test.getAsBoolean());
    }
    /** Die native Playerleiste benutzt fokussierbare TextViews, keine Android-Buttons. */
    private static TextView knopf(View view, String text) {
        if (view instanceof TextView && text.equals(((TextView) view).getText().toString())) return (TextView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            TextView found = knopf(((ViewGroup) view).getChildAt(i), text);
            if (found != null) return found;
        }
        return null;
    }
    private static TextView feld(View view, String tag) {
        if (tag.equals(view.getTag()) && view instanceof TextView) return (TextView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            TextView found = feld(((ViewGroup) view).getChildAt(i), tag);
            if (found != null) return found;
        }
        return null;
    }
    private static void tippen(View view) {
        long zeit = android.os.SystemClock.uptimeMillis();
        float x = Math.max(1, view.getWidth() / 2f);
        float y = Math.max(1, view.getHeight() / 2f);
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit, MotionEvent.ACTION_DOWN, x, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit + 20, MotionEvent.ACTION_UP, x, y, 0));
    }
    private static View mitTag(View view, String tag) {
        if (tag.equals(view.getTag())) return view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            View found = mitTag(((ViewGroup) view).getChildAt(i), tag);
            if (found != null) return found;
        }
        return null;
    }
    private static PlayerView video(View view) {
        if (view instanceof PlayerView && "video".equals(view.getTag())) return (PlayerView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            PlayerView found = video(((ViewGroup) view).getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }
    private static void doppelTippen(PlayerView view, float x) {
        long zeit = android.os.SystemClock.uptimeMillis();
        float y = Math.max(1, view.getHeight() / 2f);
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit, MotionEvent.ACTION_DOWN, x, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit + 25, MotionEvent.ACTION_UP, x, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit + 90, zeit + 90, MotionEvent.ACTION_DOWN, x, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit + 90, zeit + 115, MotionEvent.ACTION_UP, x, y, 0));
    }
    private static void wischen(PlayerView view, float von, float nach, boolean abbrechen) {
        long zeit = android.os.SystemClock.uptimeMillis();
        float y = Math.max(1, view.getHeight() / 2f);
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit, MotionEvent.ACTION_DOWN, von, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit + 80, MotionEvent.ACTION_MOVE, nach, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit + 100,
            abbrechen ? MotionEvent.ACTION_CANCEL : MotionEvent.ACTION_UP, nach, y, 0));
    }
    private static long wischBeginnen(PlayerView view, float von, float nach) {
        long zeit = android.os.SystemClock.uptimeMillis();
        float y = Math.max(1, view.getHeight() / 2f);
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit, MotionEvent.ACTION_DOWN, von, y, 0));
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit + 80, MotionEvent.ACTION_MOVE, nach, y, 0));
        return zeit;
    }
    private static void wischBeenden(PlayerView view, long zeit, float x) {
        float y = Math.max(1, view.getHeight() / 2f);
        view.dispatchTouchEvent(MotionEvent.obtain(zeit, zeit + 250, MotionEvent.ACTION_UP, x, y, 0));
    }
    private static String fokusZustand(DirektProbeActivity activity) {
        View fokus = activity.spieler.ansicht.findFocus();
        String ziel = fokus == null ? "kein Fokus" : fokus.getClass().getSimpleName()
            + " tag=" + fokus.getTag() + " text=" + (fokus instanceof TextView
                ? ((TextView) fokus).getText() : "") + " beschreibung=" + fokus.getContentDescription();
        return "windowFocus=" + activity.hasWindowFocus() + " touchMode="
            + activity.spieler.ansicht.isInTouchMode() + " " + ziel;
    }
    private static JSONObject befehl(double zeit) throws Exception {
        return new JSONObject().put("tun", "syncprepare").put("position", zeit).put("warten", true)
            .put("ereignis", new JSONObject().put("videoTime", zeit).put("playing", false));
    }

    @Test public void telefonBehaeltPlayerTonUndLautstaerke() throws Exception {
        try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
            scenario.onActivity(a -> {
                Assume.assumeFalse("Nur auf einem echten Telefon ausfuehren",
                    DirektSpieler.istFernseher(a.getResources().getConfiguration()));
                assertNotNull("Telefon behaelt den Player-Tonknopf", mitTag(a.spieler.ansicht, "ton"));
                View reihe = mitTag(a.spieler.ansicht, "handyPlayerAktionen");
                assertNotNull("Telefon hat eine kompakte Aktionsreihe", reihe);
                float dichte = a.getResources().getDisplayMetrics().density;
                for (int breite : new int[] { 304, 360, 640, 960 }) {
                    reihe.measure(View.MeasureSpec.makeMeasureSpec(Math.round(breite * dichte), View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(Math.round(48 * dichte), View.MeasureSpec.EXACTLY));
                    reihe.layout(0, 0, reihe.getMeasuredWidth(), reihe.getMeasuredHeight());
                    ViewGroup gruppe = (ViewGroup) reihe;
                    for (int i = 0; i < gruppe.getChildCount(); i++) {
                        View ziel = gruppe.getChildAt(i);
                        if (!ziel.isClickable()) continue;
                        assertEquals("Alle Aktionen bleiben in derselben Reihe", 0, ziel.getTop());
                        assertTrue("Aktion liegt innerhalb der Breite " + breite, ziel.getRight() <= reihe.getWidth());
                        assertTrue("Touchziel bleibt mindestens 48dp breit", ziel.getWidth() >= Math.round(48 * dichte));
                        assertNotNull("Symbol hat eine lesbare Beschreibung", ziel.getContentDescription());
                    }
                }
                reihe.requestLayout();
                mitTag(a.spieler.ansicht, "playerEinstellungen").performClick();
                assertNotNull("Telefon behaelt den Player-Lautstaerkeregler im Menue", mitTag(a.spieler.ansicht, "lautstaerke"));
                for (String tag : new String[] { "fassung", "hoster", "qualitaet", "untertitel", "tempo", "auto", "miniplayer" }) {
                    assertNotNull("Einstellung erreichbar: " + tag, mitTag(a.spieler.ansicht, tag));
                }
                boolean vorher = Folgen.autoplayAn(a);
                try {
                    mitTag(a.spieler.ansicht, "auto").performClick();
                    assertEquals(!vorher, Folgen.autoplayAn(a));
                    assertFalse("Auswahl schliesst das Menue", a.spieler.blendeOffen());
                    mitTag(a.spieler.ansicht, "playerEinstellungen").performClick();
                    assertEquals("Wiederholtes Oeffnen behaelt den aktuellen Zustand",
                        !vorher ? "Autoplay an" : "Autoplay aus", feld(a.spieler.ansicht, "auto").getText().toString());
                    assertNotNull(mitTag(a.spieler.ansicht, "lautstaerke"));
                } finally { Folgen.setzeAutoplayAn(a, vorher); }
            });
        }
    }

    @Test public void handyQuerformatZeigtEineReiheUndLesbareEinstellungen() throws Exception {
        String base = androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("mediaBase");
        Assume.assumeNotNull(base);
        try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
            scenario.onActivity(a -> {
                Assume.assumeFalse(DirektSpieler.istFernseher(a.getResources().getConfiguration()));
                a.setRequestedOrientation(android.content.pm.ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
            });
            AtomicBoolean bereit = new AtomicBoolean();
            warten(() -> { scenario.onActivity(a -> bereit.set(a.kern.istBereit()
                && a.spieler.ansicht.getWidth() > a.spieler.ansicht.getHeight())); return bereit.get(); });
            scenario.onActivity(a -> {
                a.spieler.titel("ELFIX · Player-Test");
                a.spieler.quelleBenannt("Lokales Testvideo", "Deutsch");
                a.spieler.quelle(base + "/probe.mp4", "datei", Collections.emptyMap(), 0);
            });
            warten(() -> { scenario.onActivity(a -> bereit.set(a.spieler.position() > 1)); return bereit.get(); });
            scenario.onActivity(a -> {
                a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PAUSE));
                a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU));
            });
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            androidx.test.uiautomator.UiDevice device = androidx.test.uiautomator.UiDevice.getInstance(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation());
            java.io.File dir = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getExternalFilesDir(null);
            assertTrue(device.takeScreenshot(new java.io.File(dir, "handy-player-quer.png")));
            scenario.onActivity(a -> mitTag(a.spieler.ansicht, "playerEinstellungen").performClick());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a -> {
                View volume = mitTag(a.spieler.ansicht, "lautstaerke");
                assertTrue("Lautstaerke sichtbar", volume.isShown());
                assertTrue("Lautstaerke hat ausreichend Bedienflaeche",
                    volume.getWidth() >= 96 * a.getResources().getDisplayMetrics().density);
                assertTrue(a.spieler.blendeOffen());
            });
            warten(() -> { scenario.onActivity(a -> {
                View view = mitTag(a.spieler.ansicht, "lautstaerke");
                boolean gezeichnet = view != null && view.isShown();
                while (view != null) {
                    gezeichnet &= view.getAlpha() >= .99f && Math.abs(view.getTranslationY()) < 1;
                    view = view.getParent() instanceof View ? (View) view.getParent() : null;
                }
                bereit.set(gezeichnet);
            }); return bereit.get(); });
            assertTrue(device.takeScreenshot(new java.io.File(dir, "handy-player-einstellungen.png")));
        }
    }

    @Test public void fernseherHatKeineTonGruppeUndBeginntDpadAufPlay() throws Exception {
        try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
            scenario.onActivity(a -> {
                Assume.assumeTrue("Nur auf einem echten Fernseher ausfuehren",
                    DirektSpieler.istFernseher(a.getResources().getConfiguration()));
                assertNull("Fernseher nutzt die Systemlautstaerke statt Player-Ton",
                    mitTag(a.spieler.ansicht, "ton"));
                assertNull("Fernseher hat keinen Player-Lautstaerkeregler",
                    mitTag(a.spieler.ansicht, "lautstaerke"));

                a.spieler.ansicht.requestFocus();
            });
            androidx.test.uiautomator.UiDevice fernbedienung = androidx.test.uiautomator.UiDevice
                .getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            java.io.File vorDpad = new java.io.File(androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().getTargetContext().getExternalFilesDir(null), "elfix-tv-before-dpad.png");
            assertTrue("TV-Vorher-Screenshot konnte nicht geschrieben werden", fernbedienung.takeScreenshot(vorDpad));
            assertEquals("Dpad würde nicht die Test-Activity erreichen", "local.elflix.android.debug",
                fernbedienung.getCurrentPackageName());
            scenario.onActivity(a -> assertTrue("Test-Activity hat vor Dpad keinen Fensterfokus: "
                + fokusZustand(a), a.hasWindowFocus()));
            assertTrue("Echter TV-Dpad-Down konnte nicht injiziert werden", fernbedienung.pressDPadDown());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a -> {
                TextView play = feld(a.spieler.ansicht, "spielen");
                assertNotNull(play);
                assertEquals(View.VISIBLE, play.getVisibility());
                assertTrue("Der erste Steuerkreuzdruck markiert Play sichtbar: " + fokusZustand(a),
                    play.hasFocus());
            });
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            java.io.File screenshot = new java.io.File(androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().getTargetContext().getExternalFilesDir(null), "elfix-tv-dpad-play.png");
            assertTrue("TV-Dpad-Fokus-Screenshot konnte nicht geschrieben werden",
                fernbedienung.takeScreenshot(screenshot));

            assertTrue("Echter TV-Dpad-Up konnte nicht injiziert werden", fernbedienung.pressDPadUp());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a -> {
                View fortschritt = mitTag(a.spieler.ansicht, "regler");
                assertNotNull(fortschritt);
                assertTrue("Steuerkreuz erreicht den sichtbar gerahmten Fortschrittsregler",
                    fortschritt.hasFocus());
            });
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            java.io.File seekScreenshot = new java.io.File(androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().getTargetContext().getExternalFilesDir(null), "elfix-tv-dpad-seek.png");
            assertTrue("TV-Regler-Fokus-Screenshot konnte nicht geschrieben werden",
                fernbedienung.takeScreenshot(seekScreenshot));

            assertTrue("Echter TV-Dpad-Down zum Play konnte nicht injiziert werden",
                fernbedienung.pressDPadDown());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a -> {
                TextView play = feld(a.spieler.ansicht, "spielen");
                assertTrue("Dpad-Down kehrt vom Regler zu Play zurück", play.hasFocus());
                TextView fassung = feld(a.spieler.ansicht, "fassung");
                assertNotNull(fassung);
            });
            AtomicBoolean fassungFokus = new AtomicBoolean();
            for (int i = 0; i < 8; i++) {
                scenario.onActivity(a -> fassungFokus.set(feld(a.spieler.ansicht, "fassung").hasFocus()));
                if (fassungFokus.get()) break;
                assertTrue("Echter TV-Dpad-Right konnte nicht injiziert werden",
                    fernbedienung.pressDPadRight());
            }
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a -> {
                TextView play = feld(a.spieler.ansicht, "spielen");
                TextView fassung = feld(a.spieler.ansicht, "fassung");
                assertTrue("Steuerkreuz erreicht nachfolgende Player-Control", fassung.hasFocus());
            });
            assertTrue("Echter TV-OK konnte nicht injiziert werden", fernbedienung.pressDPadCenter());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            scenario.onActivity(a -> {
                TextView play = feld(a.spieler.ansicht, "spielen");
                assertEquals("OK aktiviert die per Steuerkreuz erreichte Control", 1, a.fassungKlicks);

                a.spieler.blende("TV-Testmenü", Collections.singletonList("Eintrag"),
                    Collections.singletonList(() -> { }), -1);
                assertTrue("Die Blende setzt einen sichtbaren Menüfokus", a.spieler.blendeOffen());
                assertTrue(a.spieler.zurueck());
                assertFalse(a.spieler.blendeOffen());
                assertTrue("Zurück aus dem Menü markiert wieder Play", play.hasFocus());
            });
        }
    }

    @Test public void mp4UndHlsDekodierenUndSpulen() throws Exception {
        String base = androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("mediaBase");
        org.junit.Assume.assumeTrue("Lokaler MP4/HLS-Fixture-Server erforderlich", base != null);
        try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
            AtomicBoolean ready = new AtomicBoolean();
            warten(() -> { scenario.onActivity(a -> ready.set(a.kern.istBereit())); return ready.get(); });
            for (String file : new String[]{"probe.mp4", "probe.m3u8"}) {
                AtomicBoolean ack = new AtomicBoolean();
                JSONObject command = befehl(35);
                scenario.onActivity(a -> {
                    a.spieler.wechselPause();
                    a.spieler.steuern(command, () -> ack.set(true));
                    a.spieler.quelle(base + "/" + file, file.endsWith("m3u8") ? "hls" : "datei", Collections.emptyMap(), 0);
                });
                warten(ack::get);
                scenario.onActivity(a -> {
                    assertEquals(35, a.spieler.position(), 1.5);
                    a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY));
                });
                AtomicBoolean playing = new AtomicBoolean();
                warten(() -> { scenario.onActivity(a -> playing.set(a.spieler.position() > 37)); return playing.get(); });
                scenario.onActivity(a -> {
                    PlayerView bild = video(a.spieler.ansicht);
                    assertNotNull(bild);
                    wischen(bild, bild.getWidth() * .25f, bild.getWidth() * .75f, false);
                });
                scenario.onActivity(a -> {
                    try { assertTrue(a.spieler.liveStand().optDouble("duration") >= 120); }
                    catch (Exception e) { throw new AssertionError(e); }
                    a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU));
                });
                java.io.File shot = new java.io.File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                    .getTargetContext().getExternalFilesDir(null), "direkt-" + file + ".png");
                assertTrue(androidx.test.uiautomator.UiDevice.getInstance(androidx.test.platform.app.InstrumentationRegistry
                    .getInstrumentation()).takeScreenshot(shot));
            }
        }
    }
    @Test public void mp4VorschauRendertEinenEchtenFrame() throws Exception {
        String base = androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("mediaBase");
        org.junit.Assume.assumeTrue("Lokaler MP4-Fixture-Server erforderlich", base != null);
        try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
            scenario.onActivity(a -> a.spieler.quelle(base + "/watchparty-fixture.mp4", "datei",
                Collections.emptyMap(), 0));
            AtomicBoolean angelegt = new AtomicBoolean();
            warten(() -> { scenario.onActivity(a -> {
                PlayerView bild = video(a.spieler.ansicht);
                angelegt.set(bild != null && bild.getWidth() > 0);
            }); return angelegt.get(); });
            AtomicBoolean bereit = new AtomicBoolean();
            warten(() -> { scenario.onActivity(a -> {
                try { bereit.set(a.spieler.liveStand().optDouble("duration") > 0); }
                catch (Exception e) { throw new AssertionError(e); }
            }); return bereit.get(); });
            AtomicReference<Long> wischZeit = new AtomicReference<>();
            scenario.onActivity(a -> {
                PlayerView bild = video(a.spieler.ansicht);
                assertNotNull(bild);
                wischZeit.set(wischBeginnen(bild, bild.getWidth() * .25f, bild.getWidth() * .7f));
            });
            AtomicBoolean frame = new AtomicBoolean();
            warten(() -> { scenario.onActivity(a -> frame.set(a.spieler.vorschauHatFrame())); return frame.get(); });
            java.io.File vorschauBild = new java.io.File(androidx.test.platform.app.InstrumentationRegistry
                .getInstrumentation().getTargetContext().getExternalFilesDir(null), "android-preview-frame.png");
            assertTrue("Sichtbares Vorschau-Bild wird festgehalten", androidx.test.uiautomator.UiDevice
                .getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(vorschauBild));
            AtomicReference<android.graphics.Bitmap> erstesBild = new AtomicReference<>();
            scenario.onActivity(a -> {
                android.view.TextureView mini = (android.view.TextureView) mitTag(a.spieler.ansicht, "vorschau-video");
                erstesBild.set(mini.getBitmap());
                assertNotNull(erstesBild.get());
                PlayerView bild = video(a.spieler.ansicht);
                MotionEvent move = MotionEvent.obtain(wischZeit.get(), android.os.SystemClock.uptimeMillis(),
                    MotionEvent.ACTION_MOVE, bild.getWidth() * .45f, bild.getHeight() / 2f, 0);
                bild.dispatchTouchEvent(move);
                move.recycle();
                assertEquals("Neue Zeit zeigt kein altes Vorschau-Bild", 0f, mini.getAlpha(), .001f);
                assertFalse(a.spieler.vorschauHatFrame());
            });
            warten(() -> { scenario.onActivity(a -> frame.set(a.spieler.vorschauHatFrame())); return frame.get(); });
            scenario.onActivity(a -> {
                android.view.TextureView mini = (android.view.TextureView) mitTag(a.spieler.ansicht, "vorschau-video");
                android.graphics.Bitmap zweitesBild = mini.getBitmap();
                assertNotNull(zweitesBild);
                assertEquals(1f, mini.getAlpha(), .001f);
                assertFalse("Andere Videoposition liefert ein anderes echtes Bild", erstesBild.get().sameAs(zweitesBild));
                erstesBild.get().recycle();
                zweitesBild.recycle();
                PlayerView bild = video(a.spieler.ansicht);
                wischBeenden(bild, wischZeit.get(), bild.getWidth() * .45f);
                assertFalse("Loslassen räumt die Vorschau wieder ab", a.spieler.vorschauSichtbar());
            });
        }
    }
    @Test public void ladenPositionierenTouchDpadUndHintergrund() throws Exception {
        // A local 125-second PCM file exercises a real Media3 decoder without internet access.
        int size = 8000 * 125;
        ByteBuffer wav = ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN);
        wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + size)
            .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1)
            .putShort((short) 1).putInt(8000).putInt(8000).putShort((short) 1).putShort((short) 8)
            .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(size);
        while (wav.hasRemaining()) wav.put((byte) 128);
        AtomicBoolean running = new AtomicBoolean(true);
        try (ServerSocket server = new ServerSocket(0)) {
            Thread serving = new Thread(() -> {
                while (running.get()) try (Socket socket = server.accept()) {
                    java.io.BufferedReader in = new java.io.BufferedReader(new java.io.InputStreamReader(socket.getInputStream()));
                    int offset = 0;
                    for (String line; (line = in.readLine()) != null && !line.isEmpty();) {
                        if (line.toLowerCase(java.util.Locale.ROOT).startsWith("range: bytes=")) {
                            offset = Integer.parseInt(line.substring(13).split("-")[0]);
                        }
                    }
                    offset = Math.min(offset, wav.array().length - 1);
                    String header = "HTTP/1.1 " + (offset > 0 ? "206 Partial Content" : "200 OK")
                        + "\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\nContent-Length: " + (wav.array().length - offset)
                        + (offset > 0 ? "\r\nContent-Range: bytes " + offset + "-" + (wav.array().length - 1) + "/" + wav.array().length : "")
                        + "\r\nConnection: close\r\n\r\n";
                    socket.getOutputStream().write(header.getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(wav.array(), offset, wav.array().length - offset);
                } catch (Exception ignored) { }
            });
            serving.setDaemon(true); serving.start();
            try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
                AtomicBoolean ready = new AtomicBoolean();
                warten(() -> { scenario.onActivity(a -> ready.set(a.kern.istBereit())); return ready.get(); });
                AtomicBoolean ack = new AtomicBoolean();
                JSONObject command = befehl(17);
                scenario.onActivity(a -> a.spieler.steuern(command, () -> ack.set(true)));
                assertFalse("Ohne Quelle darf keine Bereitschaft gemeldet werden", ack.get());
                scenario.onActivity(a -> a.spieler.quelle("http://127.0.0.1:" + server.getLocalPort() + "/test.wav", "datei", Collections.emptyMap(), 0));
                warten(ack::get);
                scenario.onActivity(a -> {
                    assertEquals(17, a.spieler.position(), 1.5);
                    try { assertTrue(a.spieler.liveStand().optBoolean("paused")); } catch (Exception e) { throw new AssertionError(e); }
                    a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY));
                });
                AtomicBoolean progressed = new AtomicBoolean();
                warten(() -> { scenario.onActivity(a -> progressed.set(a.spieler.position() > 18)); return progressed.get(); });
                scenario.onActivity(a -> {
                    PlayerView bild = video(a.spieler.ansicht);
                    assertNotNull("Die Geste erreicht die echte Videoebene", bild);
                    double vor = a.spieler.position();
                    doppelTippen(bild, bild.getWidth() * .75f);
                    assertTrue("Doppeltipp rechts springt vor", a.spieler.position() >= vor + 8);
                    double nachRechts = a.spieler.position();
                    doppelTippen(bild, bild.getWidth() * .25f);
                    assertTrue("Doppeltipp links springt zurück", a.spieler.position() <= nachRechts - 8);
                    double vorWisch = a.spieler.position();
                    wischen(bild, bild.getWidth() * .25f, bild.getWidth() * .75f, false);
                    assertTrue("Horizontaler Wisch übernimmt erst beim Loslassen", a.spieler.position() > vorWisch + 20);
                    double nachWisch = a.spieler.position();
                    wischen(bild, bild.getWidth() * .75f, bild.getWidth() * .25f, true);
                    assertEquals("Abgebrochener Wisch verändert die Hauptposition nicht", nachWisch,
                        a.spieler.position(), 1.0);
                    a.runde = true;
                    a.host = false;
                    double gastVorher = a.spieler.position();
                    doppelTippen(bild, bild.getWidth() * .75f);
                    assertEquals("Gast-Doppeltipp bleibt ohne Seek", gastVorher, a.spieler.position(), 1.0);
                    wischen(bild, bild.getWidth() * .25f, bild.getWidth() * .75f, false);
                    assertEquals("Gast-Wisch bleibt ohne Seek", gastVorher, a.spieler.position(), 1.0);
                    a.runde = false;
                });
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP);
                scenario.onActivity(a -> {
                    a.spieler.pause();
                    a.spieler.vordergrund();
                    try { assertTrue(a.spieler.liveStand().optBoolean("paused")); } catch (Exception e) { throw new AssertionError(e); }
                    a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU));
                    TextView auto = knopf(a.spieler.ansicht, Folgen.autoplayAn(a) ? "Autoplay an" : "Autoplay aus");
                    assertNotNull(auto);
                    boolean before = Folgen.autoplayAn(a);
                    auto.performClick();
                    assertEquals(!before, Folgen.autoplayAn(a));
                    auto.performClick();
                    auto.requestFocus();
                    assertTrue(auto.hasFocus());
                });
                AtomicBoolean latest = new AtomicBoolean();
                JSONObject old = befehl(30), replacement = befehl(42);
                scenario.onActivity(a -> {
                    a.spieler.wechselPause();
                    a.spieler.steuern(old, () -> fail("Veralteter Auftrag bestätigt"));
                    a.spieler.steuern(replacement, () -> latest.set(true));
                    a.spieler.quelle("http://127.0.0.1:" + server.getLocalPort() + "/test.wav", "datei", Collections.emptyMap(), 0);
                });
                warten(latest::get);
                scenario.onActivity(a -> assertEquals(42, a.spieler.position(), 1.5));
                JSONObject introMarke = new JSONObject().put("von", 42).put("dauer", 50);
                scenario.onActivity(a -> a.marke = introMarke);
                AtomicBoolean introSichtbar = new AtomicBoolean();
                warten(() -> {
                    scenario.onActivity(a -> introSichtbar.set(knopf(a.spieler.ansicht, "Intro überspringen").getVisibility() == View.VISIBLE));
                    return introSichtbar.get();
                });
                scenario.onActivity(a -> {
                    knopf(a.spieler.ansicht, "Intro überspringen").performClick();
                    assertEquals(92, a.spieler.position(), 1.5);
                    assertEquals("Automatische Sprünge dürfen keine Intro-Belege erzeugen", 0, a.spruenge);
                });
            } finally { running.set(false); }
        }
    }

    @Test public void gastKannKeineQuelleWaehlenAberDieNaechsteFolgeAusloesen() throws Exception {
        try (ActivityScenario<DirektProbeActivity> scenario = ActivityScenario.launch(DirektProbeActivity.class)) {
            scenario.onActivity(a -> {
                a.runde = true;
                a.host = false;
                a.spieler.quellenZeichnen();
                View einstellungen = mitTag(a.spieler.ansicht, "playerEinstellungen");
                if (einstellungen != null) einstellungen.performClick();
                TextView fassung = feld(a.spieler.ansicht, "fassung");
                TextView hoster = feld(a.spieler.ansicht, "hoster");
                assertNotNull(fassung);
                assertNotNull(hoster);
                assertFalse("Gast darf keine Fassung waehlen", fassung.isEnabled());
                assertFalse("Gast darf keinen Hoster waehlen", hoster.isEnabled());
                // performClick() ruft Androids Listener auch bei einer
                // deaktivierten View direkt auf. Ein echter Tipp muss dagegen
                // bereits vor dem Handler abgewiesen werden.
                tippen(fassung);
                tippen(hoster);
                assertEquals("Deaktivierte Quellenknopfe reagieren nicht auf echte Tipps", 0,
                    a.fassungKlicks + a.hosterKlicks);

                a.spieler.naechsteVorhanden(true);
                a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_NEXT));
                assertEquals("Gaste duerfen weiter zur naechsten Folge", 1, a.naechsteKlicks);

                a.host = true;
                a.spieler.quellenZeichnen();
                assertTrue("Der Host darf eine Fassung waehlen", fassung.isEnabled());
                assertTrue("Der Host darf einen Hoster waehlen", hoster.isEnabled());
                fassung.performClick();
                hoster.performClick();
                assertEquals(1, a.fassungKlicks);
                assertEquals(1, a.hosterKlicks);
            });
        }
    }
}
