package local.elflix.android;

import android.webkit.CookieManager;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/** Re-evaluate cookies on every redirect, segment and key request. */
final class CookieNetz {
    interface Ablage {
        String lesen(String url);
        void setzen(String url, String cookie);
    }

    static OkHttpClient erstellen() {
        return erstellen(new Ablage() {
            public String lesen(String url) { return CookieManager.getInstance().getCookie(url); }
            public void setzen(String url, String cookie) { CookieManager.getInstance().setCookie(url, cookie); }
        });
    }

    static OkHttpClient erstellen(Ablage ablage) {
        return new OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS).followRedirects(true).followSslRedirects(true)
            .addNetworkInterceptor(chain -> {
                String url = chain.request().url().toString();
                Request.Builder request = chain.request().newBuilder().removeHeader("Cookie");
                String cookies = ablage.lesen(url);
                if (cookies != null && !cookies.isEmpty()) request.header("Cookie", cookies);
                Response response = chain.proceed(request.build());
                for (String cookie : response.headers("Set-Cookie")) ablage.setzen(url, cookie);
                return response;
            }).build();
    }
}
