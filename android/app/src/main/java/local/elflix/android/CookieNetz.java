package local.elflix.android;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import java.net.URI;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CountDownLatch;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Re-evaluate cookies on every redirect, segment and key request. */
final class CookieNetz {
    interface Beobachter {
        void antwort(Antwort antwort);
    }

    static final class Antwort {
        final String url;
        final String endUrl;
        final int status;
        final String inhaltstyp;
        final String typ;
        final boolean umgeleitet;
        final boolean challenge;
        final String redirectZiel;
        final List<String> gesendeteCookieNamen;
        final List<String> gesetzteCookieNamen;
        final String userAgent;
        final String referer;
        final String origin;

        Antwort(String url, String endUrl, int status, String inhaltstyp, String typ,
                boolean umgeleitet, boolean challenge, String redirectZiel,
                List<String> gesendeteCookieNamen, List<String> gesetzteCookieNamen,
                String userAgent, String referer, String origin) {
            this.url = url;
            this.endUrl = endUrl;
            this.status = status;
            this.inhaltstyp = inhaltstyp;
            this.typ = typ;
            this.umgeleitet = umgeleitet;
            this.challenge = challenge;
            this.redirectZiel = redirectZiel;
            this.gesendeteCookieNamen = gesendeteCookieNamen;
            this.gesetzteCookieNamen = gesetzteCookieNamen;
            this.userAgent = userAgent;
            this.referer = referer;
            this.origin = origin;
        }
    }

    interface Ablage {
        String lesen(String url);
        void setzen(String url, String cookie);
    }

    static OkHttpClient erstellen() {
        return erstellen((Beobachter) null);
    }

    static OkHttpClient erstellen(Beobachter beobachter) {
        return erstellen(new Ablage() {
            public String lesen(String url) { return CookieManager.getInstance().getCookie(url); }
            public void setzen(String url, String cookie) {
                CookieManager manager = CookieManager.getInstance();
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    manager.setCookie(url, cookie);
                    return;
                }
                CountDownLatch geschrieben = new CountDownLatch(1);
                new Handler(Looper.getMainLooper()).post(() ->
                    manager.setCookie(url, cookie, wert -> geschrieben.countDown()));
                try { geschrieben.await(2, TimeUnit.SECONDS); }
                catch (InterruptedException abbruch) { Thread.currentThread().interrupt(); }
            }
        }, beobachter);
    }

    static OkHttpClient erstellen(Ablage ablage) {
        return erstellen(ablage, null);
    }

    static OkHttpClient erstellen(Ablage ablage, Beobachter beobachter) {
        return new OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS).followRedirects(true).followSslRedirects(true)
            .addNetworkInterceptor(chain -> {
                String url = chain.request().url().toString();
                Request.Builder request = chain.request().newBuilder().removeHeader("Cookie");
                String cookies = ablage.lesen(url);
                if (cookies != null && !cookies.isEmpty()) request.header("Cookie", cookies);
                Response response = chain.proceed(request.build());
                for (String cookie : response.headers("Set-Cookie")) ablage.setzen(url, cookie);
                if (beobachter != null) beobachter.antwort(beschreiben(url, response));
                return response;
            }).build();
    }

    /** Eine Kennung fuer Provider-WebView, Verifizierungs-WebView, Resolver und Player. */
    static String kennung(Context context) {
        String basis = WebSettings.getDefaultUserAgent(context);
        return basis.endsWith(" ElflixAndroid/0.1") ? basis : basis + " ElflixAndroid/0.1";
    }

    static List<String> cookieNamen(String url) {
        return cookieNamenAus(CookieManager.getInstance().getCookie(url));
    }

    static List<String> cookieNamenAus(String cookieKopf) {
        if (cookieKopf == null || cookieKopf.trim().isEmpty()) return Collections.emptyList();
        ArrayList<String> namen = new ArrayList<>();
        for (String teil : cookieKopf.split(";")) {
            int gleich = teil.indexOf('=');
            String name = (gleich < 0 ? teil : teil.substring(0, gleich)).trim();
            if (!name.isEmpty() && !namen.contains(name)) namen.add(name);
        }
        Collections.sort(namen);
        return Collections.unmodifiableList(namen);
    }

    static boolean hatCloudflareSitzung(String url) {
        for (String name : cookieNamen(url)) if ("cf_clearance".equalsIgnoreCase(name)) return true;
        return false;
    }

    /** Nur Browser-Kontextkoepfe; Cookies und User-Agent kommen aus derselben WebView-Sitzung. */
    static Map<String, String> webViewKopfzeilen(Map<String, String> roh) {
        if (roh == null || roh.isEmpty()) return Collections.emptyMap();
        LinkedHashMap<String, String> kopf = new LinkedHashMap<>();
        for (Map.Entry<String, String> eintrag : roh.entrySet()) {
            String name = eintrag.getKey();
            if (!("referer".equalsIgnoreCase(name) || "origin".equalsIgnoreCase(name))) continue;
            String wert = eintrag.getValue();
            if (wert == null || wert.indexOf('\r') >= 0 || wert.indexOf('\n') >= 0) continue;
            try {
                URI uri = new URI(wert);
                if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null) continue;
            } catch (Exception ungueltig) { continue; }
            kopf.put("referer".equalsIgnoreCase(name) ? "Referer" : "Origin", wert);
        }
        return Collections.unmodifiableMap(kopf);
    }

    static String diagnose(Antwort antwort) {
        if (antwort == null) return "response unavailable";
        return "url=" + sichereUrl(antwort.url)
            + " status=" + antwort.status
            + " finalUrl=" + sichereUrl(antwort.endUrl)
            + " contentType=" + sicher(antwort.inhaltstyp)
            + " redirect=" + antwort.umgeleitet
            + " redirectTarget=" + sichereUrl(antwort.redirectZiel)
            + " sentCookieNames=" + antwort.gesendeteCookieNamen
            + " setCookieNames=" + antwort.gesetzteCookieNamen
            + " userAgent=" + sicher(antwort.userAgent)
            + " referer=" + sichereUrl(antwort.referer)
            + " origin=" + sichereUrl(antwort.origin)
            + " responseType=" + antwort.typ;
    }

    private static Antwort beschreiben(String url, Response response) {
        String endUrl = response.request().url().toString();
        String contentType = response.header("Content-Type", "");
        String klein = contentType.toLowerCase(Locale.ROOT);
        String body = "";
        boolean html = klein.contains("text/html") || klein.contains("application/xhtml");
        boolean verdaechtig = html || response.code() == 403 || response.code() == 429 || response.code() == 503;
        if (verdaechtig && response.body() != null) {
            try { body = response.peekBody(64 * 1024L).string().toLowerCase(Locale.ROOT); }
            catch (Exception ignoriert) { body = ""; }
        }
        String server = response.header("Server", "").toLowerCase(Locale.ROOT);
        boolean cfKopf = response.header("CF-Ray") != null
            || response.header("CF-Mitigated") != null || server.contains("cloudflare");
        boolean cfTorMarkup = body.contains("cf-chl-") || body.contains("cf_chl_")
            || body.contains("id=\"challenge-form\"") || body.contains("id='challenge-form'");
        java.util.regex.Matcher titel = java.util.regex.Pattern.compile("<title[^>]*>([\\s\\S]*?)</title>").matcher(body);
        String titelText = titel.find() ? titel.group(1) : "";
        boolean wartet = titelText.contains("just a moment") || titelText.contains("checking your browser")
            || titelText.contains("attention required") || titelText.contains("verify you are human");
        boolean widget = body.contains("cf-turnstile") || body.contains("challenges.cloudflare.com");
        boolean cfInfrastruktur = body.contains("challenge-platform") || widget;
        boolean sperrStatus = response.code() == 403 || response.code() == 429 || response.code() == 503;
        boolean challenge = "challenge".equalsIgnoreCase(response.header("CF-Mitigated", ""))
            || (html && cfTorMarkup && (wartet || cfInfrastruktur || sperrStatus))
            || (html && wartet && cfInfrastruktur)
            || (html && cfKopf && sperrStatus && widget);
        String typ;
        if (challenge) typ = "Challenge";
        else if (html) typ = "HTML";
        else if (klein.contains("json")) typ = "JSON";
        else if (klein.contains("mpegurl") || endUrl.toLowerCase(Locale.ROOT).contains(".m3u8")) typ = "HLS";
        else if (klein.contains("dash+xml") || endUrl.toLowerCase(Locale.ROOT).contains(".mpd")) typ = "DASH";
        else if (klein.contains("video/mp4") || endUrl.toLowerCase(Locale.ROOT).contains(".mp4")) typ = "MP4";
        else typ = "Other";
        ArrayList<String> gesetzt = new ArrayList<>();
        for (String cookie : response.headers("Set-Cookie")) {
            String name = gesetzterCookieName(cookie);
            if (!name.isEmpty() && !gesetzt.contains(name)) gesetzt.add(name);
        }
        Collections.sort(gesetzt);
        String redirectZiel = response.header("Location", "");
        String gesendet = kopf(response.request(), "Cookie");
        return new Antwort(url, endUrl, response.code(), contentType, typ,
            response.isRedirect() || !url.equals(endUrl), challenge, redirectZiel,
            cookieNamenAus(gesendet), Collections.unmodifiableList(gesetzt),
            kopf(response.request(), "User-Agent"), kopf(response.request(), "Referer"),
            kopf(response.request(), "Origin"));
    }

    private static String kopf(Request request, String name) {
        String wert = request == null ? null : request.header(name);
        return wert == null ? "" : wert;
    }

    private static String gesetzterCookieName(String kopf) {
        if (kopf == null) return "";
        int ende = kopf.indexOf(';');
        String cookie = ende < 0 ? kopf : kopf.substring(0, ende);
        int gleich = cookie.indexOf('=');
        return (gleich < 0 ? cookie : cookie.substring(0, gleich)).trim();
    }

    static String sichereUrl(String roh) {
        try {
            URI url = new URI(roh);
            String host = url.getHost();
            if (url.getScheme() == null || host == null) return "<none>";
            StringBuilder ziel = new StringBuilder(url.getScheme()).append("://").append(host);
            if (url.getPort() >= 0) ziel.append(':').append(url.getPort());
            String pfad = url.getRawPath();
            if (pfad != null) for (String teil : pfad.split("/", -1)) {
                if (teil.isEmpty()) { ziel.append('/'); continue; }
                ziel.append(teil.length() > 40 ? "<redacted>" : teil).append('/');
            }
            if (ziel.length() > 1 && ziel.charAt(ziel.length() - 1) == '/'
                && (pfad == null || !pfad.endsWith("/"))) ziel.deleteCharAt(ziel.length() - 1);
            return ziel.toString();
        } catch (Exception ungueltig) { return "<ungueltig>"; }
    }

    private static String sicher(String wert) {
        return wert == null || wert.trim().isEmpty() ? "<none>" : wert.replaceAll("[\\r\\n]", "");
    }
}
