package local.elflix.android;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.net.URI;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Ein navigationgebundener Weg in genau den aktiven Player-Rahmen.
 *
 * <p>AndroidX muss den Listener beim Anlegen des WebViews registrieren. Darum
 * bleibt seine technische Origin-Regel {@code *}; sie ist keine
 * Vertrauensentscheidung. Die eigentliche Schranke steht hier: eine Meldung
 * gilt nur fuer den aktiven WebView und Ladevorgang, ihre von WebView
 * gelieferte Origin muss zur gemeldeten URL passen, und ein Unterrahmen muss
 * zuvor als Player-Navigation beobachtet worden sein. Ausserdem darf nur der
 * eine ReplyProxy melden, den Android fuer diesen Player ausgewaehlt hat.
 *
 * <p>Ein Token im selben JavaScript-Kontext waere kein Schutz vor dem Skript
 * der Player-Seite. Deshalb behauptet diese Klasse das auch nicht. Sie trennt
 * fremde Werbe- und alte Rahmen ab; der aktive Hoster selbst bleibt fuer seine
 * eigenen Playerwerte naturgemaess die Quelle.
 */
public final class Rahmen {
    private static final String TAG = CrashReporter.TAG;
    private static final String KANAL = "elfixRahmen";
    private static final Set<String> TECHNISCHE_ORIGINS = Collections.singleton("*");
    private static final int MAX_NACHRICHT = 16 * 1024;
    private static final int MAX_ADRESSE = 4096;

    private static final String START_SKRIPT =
        "(function(){"
        + "if(window.__elfixRahmenAn)return;window.__elfixRahmenAn=true;"
        + "if(typeof " + KANAL + "==='undefined')return;"
        + "function send(kind,text){try{" + KANAL + ".postMessage(JSON.stringify({v:1,kind:kind,"
            + "href:String(location.href),video:!!document.querySelector('video'),text:String(text||'')}));}catch(e){}}"
        + "window.__elfixRahmenSenden=send;"
        + KANAL + ".onmessage=function(e){try{var m=JSON.parse(String(e.data||''));"
            + "if(!m||m.v!==1||m.kind!=='run'||typeof m.script!=='string')return;"
            + "(0,eval)(m.script);}catch(f){send('error',f&&f.message);}};"
        + "try{var old=console.log;console.log=function(){try{var t=String(arguments[0]||'');"
            + "if(t.indexOf('__elfix:')===0)send('signal',t);}catch(e){}"
            + "return old.apply(console,arguments);};}catch(e){}"
        + "function hello(){send('hello','');}hello();setTimeout(hello,1500);setTimeout(hello,5000);"
        + "})();";

    public interface Horcher {
        void meldung(WebView ansicht, String adresse, boolean hatVideo,
                     boolean istHauptdokument, String nachricht);
    }

    private static final class Zustand {
        String hauptUrl = "";
        final Map<String, Integer> kandidaten = new LinkedHashMap<>();
        JavaScriptReplyProxy spieler;
        String spielerUrl = "";
        String spielerOrigin = "";
        int spielerStaerke;
    }

    private final Horcher horcher;
    private final Map<WebView, Zustand> zustaende = new LinkedHashMap<>();

    public Rahmen(Horcher horcher) {
        this.horcher = horcher;
    }

    public static boolean verfuegbar() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
    }

    public void anschliessen(WebView ansicht) {
        if (ansicht == null || !verfuegbar()) return;
        try {
            WebViewCompat.addWebMessageListener(ansicht, KANAL, TECHNISCHE_ORIGINS,
                (view, nachricht, quelle, istHauptRahmen, antwort) ->
                    empfangen(view, nachricht, quelle, istHauptRahmen, antwort));
            WebViewCompat.addDocumentStartJavaScript(ansicht, START_SKRIPT, TECHNISCHE_ORIGINS);
        } catch (Exception fehler) {
            Log.e(TAG, "Rahmen nicht angeschlossen", fehler);
        }
    }

    /** Beginnt eine neue, sichtbare Hauptnavigation und verwirft alle alten Proxies. */
    public synchronized void ladevorgang(WebView ansicht, String hauptUrl) {
        if (ansicht == null) return;
        Zustand zustand = new Zustand();
        zustand.hauptUrl = normalisieren(hauptUrl);
        zustaende.put(ansicht, zustand);
    }

    /**
     * Merkt eine vom WebViewClient beobachtete Unterrahmen-Navigation.
     *
     * @param starkerTreffer true fuer die enge Player-Heuristik; andernfalls
     *                       wird nur eine Weiterleitung aus einer bereits
     *                       bekannten Player-Origin uebernommen
     */
    public synchronized void rahmenNavigation(WebView ansicht, String url, String referer,
                                               boolean starkerTreffer) {
        Zustand zustand = zustaende.get(ansicht);
        String ziel = normalisieren(url);
        if (zustand == null || ziel.isEmpty()) return;
        int staerke = starkerTreffer ? 2 : kandidatStaerke(zustand, referer);
        if (staerke <= 0) return;
        zustand.kandidaten.put(ziel, staerke);
        String origin = origin(ziel);
        if (!origin.isEmpty()) zustand.kandidaten.put(origin, staerke);
        while (zustand.kandidaten.size() > 48) {
            String zuerst = zustand.kandidaten.keySet().iterator().next();
            zustand.kandidaten.remove(zuerst);
        }
    }

    private static int kandidatStaerke(Zustand zustand, String referer) {
        String ref = normalisieren(referer);
        Integer direkt = zustand.kandidaten.get(ref);
        if (direkt != null) return direkt;
        Integer herkunft = zustand.kandidaten.get(origin(ref));
        return herkunft == null ? 0 : herkunft;
    }

    private void empfangen(WebView ansicht, WebMessageCompat nachricht, Uri quelle,
                           boolean istHauptRahmen, JavaScriptReplyProxy antwort) {
        String roh = nachricht == null ? "" : String.valueOf(nachricht.getData());
        if (roh.length() == 0 || roh.length() > MAX_NACHRICHT) return;
        final JSONObject meldung;
        try {
            meldung = new JSONObject(roh);
        } catch (Exception unlesbar) {
            return;
        }
        if (meldung.optInt("v", 0) != 1) return;
        String art = meldung.optString("kind", "");
        String adresse = normalisieren(meldung.optString("href", ""));
        if (adresse.isEmpty() || adresse.length() > MAX_ADRESSE) return;
        String quellOrigin = origin(String.valueOf(quelle));
        if (quellOrigin.isEmpty() || !quellOrigin.equals(origin(adresse))) return;

        boolean akzeptiert;
        boolean aktiverSpieler = false;
        synchronized (this) {
            Zustand zustand = zustaende.get(ansicht);
            if (zustand == null) return;
            if ("hello".equals(art)) {
                if (!meldung.optBoolean("video", false)) return;
                int staerke = spielerStaerke(zustand, adresse, quellOrigin, istHauptRahmen);
                if (staerke <= 0) return;
                if (zustand.spieler != null && antwort != zustand.spieler
                    && staerke <= zustand.spielerStaerke) return;
                zustand.spieler = antwort;
                zustand.spielerUrl = adresse;
                zustand.spielerOrigin = quellOrigin;
                zustand.spielerStaerke = staerke;
                akzeptiert = true;
            } else if ("signal".equals(art)) {
                aktiverSpieler = antwort == zustand.spieler
                    && adresse.equals(zustand.spielerUrl)
                    && quellOrigin.equals(zustand.spielerOrigin);
                boolean aktivesHauptdokument = istHauptRahmen
                    && quellOrigin.equals(origin(zustand.hauptUrl));
                akzeptiert = aktiverSpieler || aktivesHauptdokument;
            } else if ("error".equals(art)) {
                akzeptiert = antwort == zustand.spieler;
            } else {
                return;
            }
        }
        if (!akzeptiert) return;
        String text = meldung.optString("text", "");
        if (text.length() > MAX_NACHRICHT) return;
        if ("error".equals(art)) {
            Log.w(TAG, "Rahmenskript: " + text + " (" + quellOrigin + ")");
            return;
        }
        if (horcher != null) horcher.meldung(ansicht, adresse,
            "hello".equals(art) || aktiverSpieler, istHauptRahmen,
            "signal".equals(art) ? text : "");
    }

    private static int spielerStaerke(Zustand zustand, String adresse, String quellOrigin,
                                      boolean istHauptRahmen) {
        if (istHauptRahmen) {
            String haupt = zustand.hauptUrl;
            return !haupt.isEmpty() && quellOrigin.equals(origin(haupt)) ? 3 : 0;
        }
        Integer direkt = zustand.kandidaten.get(adresse);
        if (direkt != null) return direkt;
        return 0;
    }

    /** Schickt Arbeit ausschliesslich an den einen nativ gebundenen Player. */
    public synchronized int anSpieler(WebView ansicht, String skript) {
        if (ansicht == null || skript == null || skript.isEmpty()) return 0;
        Zustand zustand = zustaende.get(ansicht);
        if (zustand == null || zustand.spieler == null) return 0;
        try {
            JSONObject auftrag = new JSONObject();
            auftrag.put("v", 1);
            auftrag.put("kind", "run");
            auftrag.put("script", skript);
            zustand.spieler.postMessage(auftrag.toString());
            return 1;
        } catch (Exception fehler) {
            zustand.spieler = null;
            return 0;
        }
    }

    /** Alte API: ebenfalls nur der aktive Player, nie fremde Rahmen. */
    public int anAlle(WebView ansicht, String skript) {
        return anSpieler(ansicht, skript);
    }

    public synchronized boolean hatSpieler(WebView ansicht) {
        Zustand zustand = zustaende.get(ansicht);
        return zustand != null && zustand.spieler != null;
    }

    public synchronized void vergessen(WebView ansicht) {
        zustaende.remove(ansicht);
    }

    static String origin(String adresse) {
        try {
            URI uri = new URI(adresse == null ? "" : adresse);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (scheme == null || host == null) return "";
            scheme = scheme.toLowerCase(java.util.Locale.ROOT);
            host = host.toLowerCase(java.util.Locale.ROOT);
            if (!"http".equals(scheme) && !"https".equals(scheme)) return "";
            int port = uri.getPort();
            boolean standard = port < 0 || ("http".equals(scheme) && port == 80)
                || ("https".equals(scheme) && port == 443);
            return scheme + "://" + host + (standard ? "" : ":" + port);
        } catch (Exception fehler) {
            return "";
        }
    }

    static String normalisieren(String adresse) {
        try {
            URI uri = new URI(adresse == null ? "" : adresse.trim()).normalize();
            if (origin(uri.toString()).isEmpty() || uri.getUserInfo() != null) return "";
            return new URI(uri.getScheme().toLowerCase(java.util.Locale.ROOT), null,
                uri.getHost().toLowerCase(java.util.Locale.ROOT), uri.getPort(),
                uri.getPath(), uri.getQuery(), null).toString();
        } catch (Exception fehler) {
            return "";
        }
    }
}
