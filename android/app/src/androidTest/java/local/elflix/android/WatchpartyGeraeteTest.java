package local.elflix.android;

import static org.junit.Assert.*;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Hardware probe for the native side of a watchparty.  It deliberately goes
 * through the APK's copied Kern module and the real Media3 player: a mocked
 * clock/player made the old tests unable to find a pause-frame mismatch.
 *
 * The desktop half is driven by tests/watchpartygeraetetest.js.  Both halves
 * use the same relay command JSON, so a failure prints a value that can be
 * compared directly with the desktop report.
 */
@RunWith(AndroidJUnit4.class)
public final class WatchpartyGeraeteTest {
    private static final double FRAME_TOLERANZ_S = 0.001;

    private static void warten(java.util.function.BooleanSupplier bedingung, String was) throws Exception {
        long ende = System.currentTimeMillis() + 30_000;
        while (!bedingung.getAsBoolean() && System.currentTimeMillis() < ende) Thread.sleep(40);
        assertTrue(was, bedingung.getAsBoolean());
    }

    /** A seekable local source keeps this probe independent from providers/network. */
    private static final class WavServer implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0);
        final byte[] bytes;
        final AtomicBoolean an = new AtomicBoolean(true);
        WavServer() throws Exception {
            int samples = 8_000 * 125;
            ByteBuffer wav = ByteBuffer.allocate(44 + samples).order(ByteOrder.LITTLE_ENDIAN);
            wav.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + samples)
                .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1)
                .putShort((short) 1).putInt(8_000).putInt(8_000).putShort((short) 1).putShort((short) 8)
                .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(samples);
            while (wav.hasRemaining()) wav.put((byte) 128);
            bytes = wav.array();
            Thread thread = new Thread(() -> serve(), "watchparty-fixture");
            thread.setDaemon(true); thread.start();
        }
        String url() { return "http://127.0.0.1:" + server.getLocalPort() + "/watchparty.wav"; }
        private void serve() {
            while (an.get()) try (Socket socket = server.accept()) {
                java.io.BufferedReader input = new java.io.BufferedReader(
                    new java.io.InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                int offset = 0;
                for (String line; (line = input.readLine()) != null && !line.isEmpty();) {
                    if (line.toLowerCase(java.util.Locale.ROOT).startsWith("range: bytes="))
                        offset = Integer.parseInt(line.substring(13).split("-")[0]);
                }
                offset = Math.min(Math.max(0, offset), bytes.length - 1);
                String head = "HTTP/1.1 " + (offset == 0 ? "200 OK" : "206 Partial Content")
                    + "\r\nContent-Type: audio/wav\r\nAccept-Ranges: bytes\r\nContent-Length: " + (bytes.length - offset)
                    + (offset == 0 ? "" : "\r\nContent-Range: bytes " + offset + "-" + (bytes.length - 1) + "/" + bytes.length)
                    + "\r\nConnection: close\r\n\r\n";
                socket.getOutputStream().write(head.getBytes(StandardCharsets.US_ASCII));
                socket.getOutputStream().write(bytes, offset, bytes.length - offset);
            } catch (Exception ignored) { }
        }
        @Override public void close() throws Exception { an.set(false); server.close(); }
    }

    private static JSONObject control(double position, boolean playing, long waitMs) {
        try { return new JSONObject().put("tun", "anwenden").put("position", position).put("genau", true)
            .put("warten", !playing).put("wartenMs", waitMs)
            .put("ereignis", new JSONObject().put("videoTime", position).put("playing", playing)
                .put("hatUhr", true).put("versatz", 0).put("startAt", playing ? System.currentTimeMillis() + waitMs : 0));
        } catch (org.json.JSONException error) { throw new AssertionError(error); }
    }

    @Test public void pauseFrameAndScheduledStartRunOnRealPhonePlayer() throws Exception {
        try (WavServer wav = new WavServer(); ActivityScenario<DirektProbeActivity> probe = ActivityScenario.launch(DirektProbeActivity.class)) {
            AtomicBoolean kernReady = new AtomicBoolean(false);
            warten(() -> { probe.onActivity(a -> kernReady.set(a.kern.istBereit())); return kernReady.get(); }, "Android Kern wurde nicht bereit");
            probe.onActivity(a -> a.spieler.quelle(wav.url(), "datei", Collections.emptyMap(), 0));
            AtomicBoolean geladen = new AtomicBoolean(false);
            warten(() -> { probe.onActivity(a -> { try { geladen.set(a.spieler.liveStand().optDouble("duration") > 120); } catch (Exception ignored) {} }); return geladen.get(); }, "Media3 hat die Fixture nicht geladen");

            // The pause payload is the exact relay payload after steuerungPruefen.
            AtomicBoolean pauseAck = new AtomicBoolean(false);
            probe.onActivity(a -> a.spieler.steuern(control(41.250, false, 0), () -> pauseAck.set(true)));
            warten(pauseAck::get, "Pausebefehl wurde nicht ausgefuehrt");
            probe.onActivity(a -> {
                try {
                    assertTrue(a.spieler.liveStand().optBoolean("paused"));
                    assertEquals("Pause must land on the shared frame", 41.250, a.spieler.position(), FRAME_TOLERANZ_S);
                } catch (Exception failure) { throw new AssertionError(failure); }
            });

            // A delayed play must start from the prepared frame, not when the command arrived.
            AtomicBoolean playAck = new AtomicBoolean(false);
            AtomicLong returnedAt = new AtomicLong();
            AtomicLong sentAt = new AtomicLong(android.os.SystemClock.uptimeMillis());
            probe.onActivity(a -> a.spieler.steuern(control(41.250, true, 900), () -> { returnedAt.set(android.os.SystemClock.uptimeMillis()); playAck.set(true); }));
            warten(playAck::get, "Geplanter Start wurde nicht ausgefuehrt");
            long delay = returnedAt.get();
            assertTrue("scheduled start escaped the readiness barrier after " + (delay - sentAt.get()) + "ms",
                delay - sentAt.get() >= 700);
            AtomicBoolean advanced = new AtomicBoolean(false);
            warten(() -> { probe.onActivity(a -> advanced.set(a.spieler.position() > 41.45)); return advanced.get(); }, "Player lief nach Start nicht weiter");

            // A newer pause replaces an unfinished older command, as relay sequence numbers require.
            AtomicBoolean newest = new AtomicBoolean(false);
            probe.onActivity(a -> {
                a.spieler.steuern(control(55, true, 1200), () -> fail("veralteter Start durfte nicht bestaetigt werden"));
                a.spieler.steuern(control(47.500, false, 0), () -> newest.set(true));
            });
            warten(newest::get, "Neuere Pause wurde nicht ausgefuehrt");
            Thread.sleep(1400); // The superseded start deadline must also pass.
            probe.onActivity(a -> {
                try {
                    assertTrue(a.spieler.liveStand().optBoolean("paused"));
                    assertEquals(47.500, a.spieler.position(), FRAME_TOLERANZ_S);
                } catch (Exception failure) { throw new AssertionError(failure); }
            });
        }
    }
}
