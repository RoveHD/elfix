package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.webkit.WebView;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Geraeteprobe fuer echte WebView-Origin/Frame-Semantik und APK-Signaturen. */
@RunWith(AndroidJUnit4.class)
public final class SicherheitsgrenzenGeraeteTest {
    @Test
    public void nurDerBeobachtetePlayerDarfEinPrivilegiertesSignalSenden() throws Exception {
        Assume.assumeTrue(Rahmen.verfuegbar());
        try (MiniServer server = new MiniServer()) {
            String basis = "http://127.0.0.1:" + server.port();
            String main = basis + "/main";
            String player = basis + "/player";
            List<String> meldungen = new CopyOnWriteArrayList<>();
            CountDownLatch echt = new CountDownLatch(1);
            final WebView[] ansicht = new WebView[1];

            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
                WebView web = new WebView(InstrumentationRegistry.getInstrumentation().getTargetContext());
                web.getSettings().setJavaScriptEnabled(true);
                Rahmen rahmen = new Rahmen((view, url, video, haupt, text) -> {
                    if (text != null && !text.isEmpty()) {
                        meldungen.add(text);
                        if (text.contains("\"currentTime\":12")) echt.countDown();
                    }
                });
                rahmen.anschliessen(web);
                rahmen.ladevorgang(web, main);
                rahmen.rahmenNavigation(web, player, main, true);
                web.loadUrl(main);
                ansicht[0] = web;
            });

            assertTrue("Der beobachtete Player meldete sich nicht", echt.await(10, TimeUnit.SECONDS));
            Thread.sleep(2500);
            assertTrue(meldungen.contains("mess:{\"currentTime\":12,\"duration\":120}"));
            assertFalse("Der fremde Video-Rahmen wurde als Player akzeptiert",
                meldungen.contains("mess:{\"currentTime\":999,\"duration\":1000}"));
            assertEquals(1, meldungen.size());
            InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> ansicht[0].destroy());
        }
    }

    @Test
    public void dieInstallierteDebugApkBestehtPaketUndSignaturpruefung() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        Aktualisierung aktualisierung = new Aktualisierung(context, null);
        String quelle = context.getApplicationInfo().sourceDir;
        assertEquals("", aktualisierung.apkBeanstandung(new java.io.File(quelle)));
    }

    private static final class MiniServer implements AutoCloseable {
        private final ServerSocket server = new ServerSocket(0);
        private final Thread faden;
        private volatile boolean offen = true;

        MiniServer() throws Exception {
            faden = new Thread(this::laufen, "elfix-frame-security-test");
            faden.start();
        }

        int port() {
            return server.getLocalPort();
        }

        private void laufen() {
            while (offen) {
                try (Socket socket = server.accept()) {
                    BufferedReader leser = new BufferedReader(new InputStreamReader(
                        socket.getInputStream(), StandardCharsets.US_ASCII));
                    String anfrage = leser.readLine();
                    String pfad = anfrage == null ? "/" : anfrage.split(" ")[1];
                    String koerper;
                    if ("/main".equals(pfad)) {
                        koerper = "<!doctype html><iframe src='/player'></iframe><iframe src='/ad'></iframe>";
                    } else if ("/player".equals(pfad)) {
                        koerper = "<!doctype html><video></video><script>setTimeout(function(){window.__elfixRahmenSenden('signal','mess:{\\\"currentTime\\\":12,\\\"duration\\\":120}')},1900)</script>";
                    } else {
                        koerper = "<!doctype html><video></video><script>setTimeout(function(){window.__elfixRahmenSenden('signal','mess:{\\\"currentTime\\\":999,\\\"duration\\\":1000}')},1900)</script>";
                    }
                    byte[] inhalt = koerper.getBytes(StandardCharsets.UTF_8);
                    byte[] kopf = ("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n"
                        + "Content-Length: " + inhalt.length + "\r\nConnection: close\r\n\r\n")
                        .getBytes(StandardCharsets.US_ASCII);
                    OutputStream aus = socket.getOutputStream();
                    aus.write(kopf);
                    aus.write(inhalt);
                    aus.flush();
                } catch (Exception ende) {
                    if (offen) throw new RuntimeException(ende);
                }
            }
        }

        @Override
        public void close() throws Exception {
            offen = false;
            server.close();
            faden.join(2000);
        }
    }
}
