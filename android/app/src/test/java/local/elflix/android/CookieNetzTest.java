package local.elflix.android;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.Test;

public class CookieNetzTest {
    @Test public void cookiesFollowTheDestinationIncludingRedirectsAndNewCookies() throws Exception {
        try (MockWebServer first = new MockWebServer(); MockWebServer second = new MockWebServer()) {
            first.start(); second.start();
            String start = first.url("/start").toString();
            String target = second.url("/movie.m3u8").newBuilder().host("127.0.0.1").build().toString();
            Map<String, String> cookies = new HashMap<>();
            cookies.put(start, "provider=private");
            cookies.put(target, "cdn=own");
            Map<String, String> received = new HashMap<>();
            OkHttpClient client = CookieNetz.erstellen(new CookieNetz.Ablage() {
                public String lesen(String url) { return cookies.get(url); }
                public void setzen(String url, String cookie) { received.put(url, cookie); }
            });
            first.enqueue(new MockResponse().setResponseCode(302).addHeader("Location", target)
                .addHeader("Set-Cookie", "provider=new; Path=/"));
            second.enqueue(new MockResponse().setBody("#EXTM3U").addHeader("Set-Cookie", "cdn=new; Path=/"));
            try (Response response = client.newCall(new Request.Builder().url(start)
                .header("Cookie", "stale=must-not-leak").header("Range", "bytes=0-99").build()).execute()) {
                assertEquals(200, response.code());
            }
            assertEquals("provider=private", first.takeRequest(2, TimeUnit.SECONDS).getHeader("Cookie"));
            okhttp3.mockwebserver.RecordedRequest redirected = second.takeRequest(2, TimeUnit.SECONDS);
            assertEquals("cdn=own", redirected.getHeader("Cookie"));
            assertEquals("bytes=0-99", redirected.getHeader("Range"));
            assertEquals("provider=new; Path=/", received.get(start));
            assertEquals("cdn=new; Path=/", received.get(target));
            second.enqueue(new MockResponse().setBody("key"));
            try (Response response = client.newCall(new Request.Builder().url(second.url("/key"))
                .header("Cookie", "provider=private").build()).execute()) { assertEquals(200, response.code()); }
            assertNull(second.takeRequest(2, TimeUnit.SECONDS).getHeader("Cookie"));
        }
    }

    @Test public void cookieNamenEnthaltenKeineWerteOderAttribute() {
        assertEquals(java.util.Arrays.asList("a", "cf_clearance"),
            CookieNetz.cookieNamenAus("cf_clearance=geheim; a=noch-geheimer"));
    }

    @Test public void challengeWebViewBekommtNurRefererUndOrigin() {
        Map<String, String> roh = new HashMap<>();
        roh.put("User-Agent", "eigener-agent");
        roh.put("Cookie", "geheim=wert");
        roh.put("Referer", "https://provider.example/folge/1");
        roh.put("Origin", "https://provider.example");
        roh.put("X-Test", "nein");
        Map<String, String> web = CookieNetz.webViewKopfzeilen(roh);
        assertEquals(2, web.size());
        assertEquals("https://provider.example/folge/1", web.get("Referer"));
        assertEquals("https://provider.example", web.get("Origin"));
        assertFalse(web.containsKey("Cookie"));
        assertFalse(web.containsKey("User-Agent"));
    }

    @Test public void turnstileAlleinIstKeineCloudflareSperre() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            AtomicReference<CookieNetz.Antwort> gesehen = new AtomicReference<>();
            OkHttpClient client = CookieNetz.erstellen(new CookieNetz.Ablage() {
                public String lesen(String url) { return "session=privat"; }
                public void setzen(String url, String cookie) { }
            }, gesehen::set);
            server.enqueue(new MockResponse().setResponseCode(200)
                .addHeader("Content-Type", "text/html")
                .setBody("<html><div class=\"cf-turnstile\"></div><p>Newsletter</p></html>"));
            try (Response response = client.newCall(new Request.Builder().url(server.url("/newsletter")).build()).execute()) {
                assertEquals(200, response.code());
            }
            assertNotNull(gesehen.get());
            assertFalse(gesehen.get().challenge);
            assertEquals(java.util.Collections.singletonList("session"), gesehen.get().gesendeteCookieNamen);
        }
    }

    @Test public void responseTypeAndChallengeNeedActualEvidence() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            AtomicReference<CookieNetz.Antwort> gesehen = new AtomicReference<>();
            OkHttpClient client = CookieNetz.erstellen(new CookieNetz.Ablage() {
                public String lesen(String url) { return null; }
                public void setzen(String url, String cookie) { }
            }, gesehen::set);
            server.enqueue(new MockResponse().addHeader("Content-Type", "application/json").setBody("{\"error\":\"denied\"}"));
            try (Response ignored = client.newCall(new Request.Builder().url(server.url("/stream.m3u8")).build()).execute()) {
                assertEquals("JSON", gesehen.get().typ);
            }
            server.enqueue(new MockResponse().setResponseCode(403).addHeader("Content-Type", "text/html").addHeader("CF-Ray", "fixture")
                .setBody("<html><title>Access denied</title><script src='/cdn-cgi/challenge-platform/jsd/main.js'></script></html>"));
            try (Response ignored = client.newCall(new Request.Builder().url(server.url("/page")).build()).execute()) {
                assertFalse(gesehen.get().challenge);
            }
            server.enqueue(new MockResponse().addHeader("Content-Type", "text/html")
                .setBody("<html><title>Just a moment</title><p>Loading video</p></html>"));
            try (Response ignored = client.newCall(new Request.Builder().url(server.url("/page")).build()).execute()) {
                assertFalse(gesehen.get().challenge);
            }
        }
    }

    @Test public void cloudflareKopfSperrstatusUndWidgetSindChallenge() throws Exception {
        try (MockWebServer server = new MockWebServer()) {
            server.start();
            AtomicReference<CookieNetz.Antwort> gesehen = new AtomicReference<>();
            OkHttpClient client = CookieNetz.erstellen(new CookieNetz.Ablage() {
                public String lesen(String url) { return null; }
                public void setzen(String url, String cookie) { }
            }, gesehen::set);
            server.enqueue(new MockResponse().setResponseCode(403)
                .addHeader("Content-Type", "text/html")
                .addHeader("CF-Ray", "test")
                .addHeader("Set-Cookie", "cf_clearance=niemals-loggen; Path=/; Secure")
                .setBody("<html><div class=\"cf-turnstile\"></div></html>"));
            try (Response response = client.newCall(new Request.Builder().url(server.url("/stream.m3u8")).build()).execute()) {
                assertEquals(403, response.code());
            }
            assertTrue(gesehen.get().challenge);
            assertEquals(java.util.Collections.singletonList("cf_clearance"), gesehen.get().gesetzteCookieNamen);
            assertFalse(CookieNetz.diagnose(gesehen.get()).contains("niemals-loggen"));
        }
    }
}
