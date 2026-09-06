package local.elflix.android;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
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
}
