package local.elflix.android;

import static org.junit.Assert.*;

import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Real WebView cookie store -> Media3 HTTP transport, using only a local fixture. */
@RunWith(AndroidJUnit4.class)
public class CookieNetzGeraeteTest {
    @Test public void cookieManagerRetainsDomainSecureAndExpiryRules() throws Exception {
        String https = "https://elfix-session-fixture.invalid/";
        android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        CountDownLatch stored = new CountDownLatch(3);
        instrumentation.runOnMainSync(() -> {
            CookieManager manager = CookieManager.getInstance();
            manager.setCookie(https, "elfix_fixture_secure=local; Secure; SameSite=None; Domain=elfix-session-fixture.invalid; Path=/", ok -> stored.countDown());
            manager.setCookie(https, "elfix_fixture_host=local; Secure; Path=/", ok -> stored.countDown());
            manager.setCookie(https, "elfix_fixture_expired=local; Max-Age=0; Path=/", ok -> stored.countDown());
        });
        try {
            assertTrue(stored.await(5, TimeUnit.SECONDS));
            CookieManager.getInstance().flush();
            assertTrue(CookieNetz.cookieNamen(https).contains("elfix_fixture_secure"));
            assertFalse(CookieNetz.cookieNamen("http://elfix-session-fixture.invalid/").contains("elfix_fixture_secure"));
            assertTrue(CookieNetz.cookieNamen("https://sub.elfix-session-fixture.invalid/").contains("elfix_fixture_secure"));
            assertFalse(CookieNetz.cookieNamen("https://sub.elfix-session-fixture.invalid/").contains("elfix_fixture_host"));
            assertFalse(CookieNetz.cookieNamen(https).contains("elfix_fixture_expired"));
        } finally {
            instrumentation.runOnMainSync(() -> {
                CookieManager.getInstance().setCookie(https, "elfix_fixture_secure=; Max-Age=0; Secure; Domain=elfix-session-fixture.invalid; Path=/");
                CookieManager.getInstance().setCookie(https, "elfix_fixture_host=; Max-Age=0; Secure; Path=/");
                CookieManager.getInstance().flush();
            });
        }
    }

    @Test public void webViewSessionReachesMedia3AndImmediateRedirect() throws Exception {
        try (Fixture fixture = new Fixture()) {
            String base = "http://localhost:" + fixture.server.getLocalPort();
            String path = "/elfix-session-fixture/";
            WebView[] browser = new WebView[1];
            String[] agent = new String[1];
            CountDownLatch loaded = new CountDownLatch(1);
            android.app.Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
            instrumentation.runOnMainSync(() -> {
                browser[0] = new WebView(instrumentation.getTargetContext());
                agent[0] = CookieNetz.kennung(instrumentation.getTargetContext());
                browser[0].getSettings().setUserAgentString(agent[0]);
                browser[0].setWebViewClient(new WebViewClient() {
                    @Override public void onPageFinished(WebView view, String url) {
                        if (url.endsWith("/seed")) loaded.countDown();
                    }
                });
                browser[0].loadUrl(base + path + "seed");
            });
            try {
                assertTrue("local page finished", loaded.await(15, TimeUnit.SECONDS));
                CookieManager.getInstance().flush();
                assertTrue(CookieNetz.cookieNamen(base + path + "redirect").contains("elfix_fixture_session"));
                Map<String, String> headers = new HashMap<>();
                headers.put("User-Agent", agent[0]);
                headers.put("Referer", base + path + "seed");
                headers.put("Origin", base);
                OkHttpDataSource source = new OkHttpDataSource.Factory(CookieNetz.erstellen())
                    .setDefaultRequestProperties(headers).createDataSource();
                try {
                    source.open(new DataSpec.Builder().setUri(Uri.parse(base + path + "redirect")).setLength(5).build());
                    byte[] data = new byte[5];
                    int read = 0;
                    while (read < data.length) {
                        int part = source.read(data, read, data.length - read);
                        if (part < 0) break;
                        read += part;
                    }
                    assertEquals("media", new String(data, StandardCharsets.UTF_8));
                } finally { source.close(); }
                Map<String, String> first = fixture.requests.get(path + "redirect");
                Map<String, String> media = fixture.requests.get(path + "media");
                assertNotNull(first); assertNotNull(media);
                assertTrue("WebView cookie reaches native media request", first.getOrDefault("cookie", "").contains("elfix_fixture_session="));
                assertTrue("Set-Cookie visible on immediate redirect", media.getOrDefault("cookie", "").contains("elfix_fixture_hop="));
                assertEquals(agent[0], media.get("user-agent"));
                assertEquals(base + path + "seed", media.get("referer"));
                assertEquals(base, media.get("origin"));
                assertEquals("bytes=0-4", media.get("range"));
                assertFalse("host-only cookie stays on its host", CookieNetz.cookieNamen(
                    "http://127.0.0.1:" + fixture.server.getLocalPort() + path + "media").contains("elfix_fixture_session"));
                assertFalse("path cookie stays in its path", CookieNetz.cookieNamen(base + "/outside").contains("elfix_fixture_session"));
            } finally {
                instrumentation.runOnMainSync(() -> {
                    browser[0].destroy();
                    for (String name : new String[] { "elfix_fixture_session", "elfix_fixture_hop" }) {
                        CookieManager.getInstance().setCookie(base, name + "=; Path=" + path + "; Max-Age=0");
                    }
                    CookieManager.getInstance().flush();
                });
            }
        }
    }

    private static final class Fixture implements AutoCloseable {
        final ServerSocket server = new ServerSocket(0);
        final Map<String, Map<String, String>> requests = new ConcurrentHashMap<>();
        volatile boolean running = true;
        Fixture() throws Exception {
            Thread worker = new Thread(() -> {
                while (running) {
                    try (Socket socket = server.accept()) {
                        socket.setSoTimeout(5000);
                        BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.US_ASCII));
                        String line = reader.readLine();
                        if (line == null) continue;
                        String path = line.split(" ")[1];
                        Map<String, String> headers = new HashMap<>();
                        while ((line = reader.readLine()) != null && !line.isEmpty()) {
                            int separator = line.indexOf(':');
                            if (separator > 0) headers.put(line.substring(0, separator).toLowerCase(java.util.Locale.ROOT), line.substring(separator + 1).trim());
                        }
                        requests.put(path, headers);
                        boolean seed = path.endsWith("/seed");
                        boolean redirect = path.endsWith("/redirect");
                        byte[] body = (seed ? "<html><body>Local session fixture</body></html>" : "media").getBytes(StandardCharsets.UTF_8);
                        String response = "HTTP/1.1 " + (redirect ? "302 Found" : "200 OK") + "\r\n"
                            + "Content-Type: " + (seed ? "text/html" : "video/mp4") + "\r\n"
                            + (seed ? "Set-Cookie: elfix_fixture_session=local; Path=/elfix-session-fixture/; HttpOnly; SameSite=Lax\r\n" : "")
                            + (redirect ? "Location: /elfix-session-fixture/media\r\nSet-Cookie: elfix_fixture_hop=local; Path=/elfix-session-fixture/; HttpOnly\r\n" : "")
                            + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
                        socket.getOutputStream().write(response.getBytes(StandardCharsets.US_ASCII));
                        socket.getOutputStream().write(body);
                    } catch (Exception ignored) { /* Closing the local fixture stops accept(). */ }
                }
            }, "elfix-cookie-fixture");
            worker.setDaemon(true);
            worker.start();
        }
        @Override public void close() throws Exception { running = false; server.close(); }
    }
}
