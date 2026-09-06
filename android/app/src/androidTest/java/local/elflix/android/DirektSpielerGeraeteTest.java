package local.elflix.android;

import static org.junit.Assert.*;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
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
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class DirektSpielerGeraeteTest {
    private static void warten(java.util.function.BooleanSupplier test) throws Exception {
        long ende = System.currentTimeMillis() + 30000;
        while (!test.getAsBoolean() && System.currentTimeMillis() < ende) Thread.sleep(100);
        assertTrue("Bedingung nach 30 Sekunden nicht erfüllt", test.getAsBoolean());
    }
    private static Button knopf(View view, String text) {
        if (view instanceof Button && text.equals(((Button) view).getText().toString())) return (Button) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            Button found = knopf(((ViewGroup) view).getChildAt(i), text);
            if (found != null) return found;
        }
        return null;
    }
    private static JSONObject befehl(double zeit) throws Exception {
        return new JSONObject().put("tun", "syncprepare").put("position", zeit).put("warten", true)
            .put("ereignis", new JSONObject().put("videoTime", zeit).put("playing", false));
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
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_DPAD_UP);
                scenario.onActivity(a -> {
                    a.spieler.pause();
                    a.spieler.vordergrund();
                    try { assertTrue(a.spieler.liveStand().optBoolean("paused")); } catch (Exception e) { throw new AssertionError(e); }
                    a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MENU));
                    Button auto = knopf(a.spieler.ansicht, Folgen.autoplayAn(a) ? "Autoplay: an" : "Autoplay: aus");
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
}
