package local.elflix.android;

import static org.junit.Assert.*;
import android.view.KeyEvent;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Echte Fernbedienung und Media3-Wiedergabe, ohne Anbieter oder Watchparty. */
@RunWith(AndroidJUnit4.class)
public class TvMitteTasteTest {
    private static void warten(java.util.function.BooleanSupplier pruefung) throws Exception {
        long ende = System.currentTimeMillis() + 20000;
        while (!pruefung.getAsBoolean() && System.currentTimeMillis() < ende) Thread.sleep(100);
        assertTrue("Playerzustand blieb aus", pruefung.getAsBoolean());
    }

    private static boolean pausiert(ActivityScenario<DirektProbeActivity> szene) {
        AtomicBoolean wert = new AtomicBoolean();
        szene.onActivity(a -> {
            try { wert.set(a.spieler.liveStand().optBoolean("paused")); }
            catch (org.json.JSONException e) { throw new AssertionError(e); }
        });
        return wert.get();
    }

    @Test public void okSchaltetSofortAuchBeiVerborgenerLeisteUndMenuesBleibenBedienbar() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 5, java.net.InetAddress.getByName("127.0.0.1"));
             ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            UiDevice remote = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            AtomicBoolean bereit = new AtomicBoolean();
            warten(() -> {
                szene.onActivity(a -> bereit.set(a.hasWindowFocus() && a.kern.istBereit()));
                return bereit.get();
            });
            assertEquals("Test muss die Eingaben im echten Player erhalten",
                InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName(),
                remote.getCurrentPackageName());
            szene.onActivity(a -> {
                assertTrue(DirektSpieler.istFernseher(a.getResources().getConfiguration()));
                try {
                    int size = 8000 * 75;
                    ByteBuffer wav = ByteBuffer.allocate(44 + size).order(ByteOrder.LITTLE_ENDIAN);
                    wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + size)
                        .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1)
                        .putShort((short) 1).putInt(8000).putInt(8000).putShort((short) 1).putShort((short) 8)
                        .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(size);
                    while (wav.hasRemaining()) wav.put((byte) 128);
                    Thread liefern = new Thread(() -> {
                        while (!server.isClosed()) try (Socket gast = server.accept()) {
                            java.io.BufferedReader ein = new java.io.BufferedReader(
                                new java.io.InputStreamReader(gast.getInputStream()));
                            for (String zeile; (zeile = ein.readLine()) != null && !zeile.isEmpty();) { }
                            String kopf = "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: "
                                + wav.array().length + "\r\nConnection: close\r\n\r\n";
                            gast.getOutputStream().write(kopf.getBytes(StandardCharsets.US_ASCII));
                            gast.getOutputStream().write(wav.array());
                        } catch (java.io.IOException ignoriert) { }
                    }, "tv-mitteltaste-medium");
                    liefern.setDaemon(true);
                    liefern.start();
                    a.spieler.quelle("http://127.0.0.1:" + server.getLocalPort() + "/probe.wav",
                        "datei", Collections.emptyMap(), 0);
                } catch (Exception e) { throw new AssertionError(e); }
            });
            warten(() -> {
                szene.onActivity(a -> bereit.set(a.spieler.position() > 0.2));
                return bereit.get();
            });
            assertTrue(remote.pressDPadCenter());
            warten(() -> pausiert(szene));
            // Ein gehaltenes OK darf nicht abwechselnd starten und pausieren.
            szene.onActivity(a -> {
                a.spieler.taste(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER));
                a.spieler.taste(new KeyEvent(0, 1, KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_DPAD_CENTER, 1));
                a.spieler.taste(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_DPAD_CENTER));
            });
            warten(() -> !pausiert(szene));
            warten(() -> {
                szene.onActivity(a -> bereit.set(!a.spieler.ansicht.findViewWithTag("spielen").isShown()));
                return bereit.get();
            });
            assertTrue(remote.pressDPadCenter());
            warten(() -> pausiert(szene));
            assertTrue(remote.pressDPadCenter());
            warten(() -> !pausiert(szene));

            // Fuer die Menuepruefung sichtbar pausieren: UIAutomator wartet
            // nach Tasten auf Ruhe, waehrend eine laufende Leiste ausblendet.
            assertTrue(remote.pressDPadCenter());
            warten(() -> pausiert(szene));
            for (int i = 0; i < 8; i++) {
                szene.onActivity(a -> bereit.set(a.spieler.ansicht.findViewWithTag("fassung").hasFocus()));
                if (bereit.get()) break;
                assertTrue(remote.pressDPadRight());
            }
            szene.onActivity(a -> assertTrue("Quellenknopf muss wirklich markiert sein",
                a.spieler.ansicht.findViewWithTag("fassung").hasFocus()));
            assertTrue(remote.pressDPadCenter());
            warten(() -> {
                szene.onActivity(a -> bereit.set(a.fassungKlicks == 1));
                return bereit.get();
            });
            AtomicInteger ausgewaehlt = new AtomicInteger();
            szene.onActivity(a -> a.spieler.blende("Testmenü", Collections.singletonList("Auswählen"),
                Collections.singletonList(() -> ausgewaehlt.incrementAndGet()), 0));
            assertTrue(remote.pressDPadCenter());
            warten(() -> ausgewaehlt.get() == 1);
            assertTrue("Menübestätigung darf die Wiedergabe nicht starten", pausiert(szene));
        }
    }
}
