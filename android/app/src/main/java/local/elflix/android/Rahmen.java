package local.elflix.android;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebView;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * Der Weg in den Rahmen des Hosters.
 *
 * <p>Das Video liegt nicht auf der Anbieterseite. Es liegt in einem Rahmen von
 * einem fremden Wirt, und dorthin reicht {@code WebView.evaluateJavascript}
 * nicht - die Methode kennt nur das Hauptdokument. Am Rechner ist das kein
 * Thema: Electron spielt in jeden Rahmen ein. Auf Android hiess das bisher,
 * dass drei Funktionen nicht zu haben waren - Intromarken, Qualitaetswahl und
 * eine Messung, die wirklich sieht, was laeuft.
 *
 * <p>Diese Klasse schliesst die Luecke mit den beiden AndroidX-Gegenstuecken:
 * {@code addDocumentStartJavaScript} spielt beim Start jedes Dokuments ein
 * kurzes Startskript ein - in jeden Rahmen -, und {@code addWebMessageListener}
 * gibt jedem Rahmen einen Kanal zurueck. Ueber diesen Kanal meldet sich ein
 * Rahmen an; danach laesst sich ihm gezielt Arbeit schicken.
 *
 * <p>Bewusst kein Kunstgriff mit eingeschmuggeltem HTML: der Ausweg, die
 * Antwort des Hosters unterwegs umzuschreiben, repariert einen Anbieter und
 * zerlegt zwei andere.
 *
 * <p>Ist die Funktion auf einem Geraet nicht vorhanden - WebView aelter als 83
 * -, faellt alles still auf das Hauptdokument zurueck. Der Rest der App merkt
 * davon nichts ausser {@link #verfuegbar()}.
 */
public final class Rahmen {
    private static final String TAG = CrashReporter.TAG;
    /** Der Name, unter dem der Kanal in jedem Rahmen steht. */
    private static final String KANAL = "elfixRahmen";
    /** Jeder Wirt - das Video kann ueberall liegen, und der Hoster wechselt staendig. */
    private static final Set<String> ALLE_WIRTE = Collections.singleton("*");

    /**
     * Das Startskript.
     *
     * <p>Kurz mit Absicht: es entscheidet nichts, es meldet sich nur an und
     * fuehrt aus, was hereinkommt. Alles Weitere sind die geteilten Skripte,
     * dieselben wie am Rechner - sie werden ueber den Kanal nachgereicht, weil
     * sie je Folge anders aussehen (die Marke dieser Staffel etwa).
     *
     * <p>Ausgefuehrt wird nur, was durch den Rueckkanal kommt. Den kann die
     * Seite nicht bedienen: {@code onmessage} traegt ausschliesslich, was die
     * App ueber ihren {@link JavaScriptReplyProxy} schickt.
     */
    private static final String START_SKRIPT =
        "(function(){"
        + "if(window.__elfixRahmenAn)return;"
        + "window.__elfixRahmenAn=true;"
        + "if(typeof " + KANAL + "==='undefined')return;"
        + KANAL + ".onmessage=function(ereignis){"
            + "try{(0,eval)(String(ereignis.data));}catch(fehler){"
                // Ein Fehler im nachgereichten Skript darf den Rahmen nicht
                // stumm machen - der naechste Auftrag soll trotzdem ankommen.
                + "try{" + KANAL + ".postMessage('fehler:'+(fehler&&fehler.message));}catch(e){}"
            + "}"
        + "};"
        // Die Anmeldung sagt gleich mit, ob hier ueberhaupt ein Video liegt.
        // Java muss sonst raten, welchem der Rahmen es die Spielerarbeit gibt.
        + "var melden=function(){"
            + "try{" + KANAL + ".postMessage('hier:'+(document.querySelector('video')?'video':'leer')"
                + "+':'+location.href);}catch(e){}"
        + "};"
        + "melden();"
        // Der Hoster baut sein Video oft erst nach dem Laden ein. Zweimal
        // nachsehen genuegt: danach steht es, oder es kommt hier keins.
        + "setTimeout(melden,1500);setTimeout(melden,5000);"
        + "})();";

    /** Was ein Rahmen von sich aus meldet. */
    public interface Horcher {
        /**
         * @param ansicht der WebView, zu dem der Rahmen gehoert
         * @param adresse die Adresse des Rahmens
         * @param hatVideo ob in diesem Rahmen ein {@code <video>} liegt
         * @param nachricht die rohe Meldung, fuer alles Weitere
         */
        void meldung(WebView ansicht, String adresse, boolean hatVideo, String nachricht);
    }

    private final Horcher horcher;
    /** Je WebView die Rahmen, die sich gemeldet haben - in der Reihenfolge ihres Auftauchens. */
    private final Map<WebView, Map<JavaScriptReplyProxy, String>> rahmen = new LinkedHashMap<>();
    /** In welchen Rahmen ein Video liegt. */
    private final Set<JavaScriptReplyProxy> mitVideo = new HashSet<>();

    public Rahmen(Horcher horcher) {
        this.horcher = horcher;
    }

    /**
     * Ob dieses Geraet den Weg in die Rahmen kennt.
     *
     * <p>Beide Faehigkeiten werden gebraucht: ohne das Startskript kommt
     * nichts hinein, ohne den Kanal nichts heraus.
     */
    public static boolean verfuegbar() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
    }

    /**
     * Einen WebView anschliessen. Einmal je Anbieter, direkt nach dem Anlegen -
     * das Startskript gilt erst ab dem naechsten Dokument.
     */
    public void anschliessen(WebView ansicht) {
        if (ansicht == null || !verfuegbar()) return;
        try {
            WebViewCompat.addWebMessageListener(ansicht, KANAL, ALLE_WIRTE,
                (view, nachricht, quelle, istHauptRahmen, antwort) ->
                    empfangen(view, nachricht, quelle, antwort));
            WebViewCompat.addDocumentStartJavaScript(ansicht, START_SKRIPT, ALLE_WIRTE);
        } catch (Exception fehler) {
            // Ein WebView, der das nicht mitmacht, ist kein Grund zum Absturz -
            // die App laeuft dann wie vorher, nur ohne Rahmenzugriff.
            Log.e(TAG, "Rahmen nicht angeschlossen", fehler);
        }
    }

    private void empfangen(WebView ansicht, WebMessageCompat nachricht, Uri quelle,
                           JavaScriptReplyProxy antwort) {
        String text = nachricht == null ? "" : String.valueOf(nachricht.getData());
        if (text.startsWith("fehler:")) {
            Log.w(TAG, "Rahmenskript: " + text.substring(7) + " (" + quelle + ")");
            return;
        }
        if (!text.startsWith("hier:")) {
            if (horcher != null) horcher.meldung(ansicht, String.valueOf(quelle), false, text);
            return;
        }
        String rest = text.substring(5);
        int trenner = rest.indexOf(':');
        boolean hatVideo = trenner > 0 && "video".equals(rest.substring(0, trenner));
        String adresse = trenner > 0 ? rest.substring(trenner + 1) : String.valueOf(quelle);

        rahmen.computeIfAbsent(ansicht, unbenutzt -> new LinkedHashMap<>()).put(antwort, adresse);
        if (hatVideo) mitVideo.add(antwort);
        else mitVideo.remove(antwort);
        if (horcher != null) horcher.meldung(ansicht, adresse, hatVideo, text);
    }

    /**
     * Ein Skript in alle Rahmen dieses WebViews, in denen ein Video liegt.
     *
     * <p>Das Gegenstueck zu {@code executeJavaScriptInMediaFrames} am Rechner -
     * und aus demselben Grund auf Rahmen mit Video beschraenkt: ein Skript, das
     * den Player sucht, hat in einem Werberahmen nichts verloren.
     *
     * @return in wie viele Rahmen es ging
     */
    public int anSpieler(WebView ansicht, String skript) {
        return schicken(ansicht, skript, true);
    }

    /** Ein Skript in jeden gemeldeten Rahmen, mit Video oder ohne. */
    public int anAlle(WebView ansicht, String skript) {
        return schicken(ansicht, skript, false);
    }

    private int schicken(WebView ansicht, String skript, boolean nurMitVideo) {
        if (ansicht == null || skript == null || skript.isEmpty()) return 0;
        Map<JavaScriptReplyProxy, String> ziele = rahmen.get(ansicht);
        if (ziele == null || ziele.isEmpty()) return 0;
        int erreicht = 0;
        for (JavaScriptReplyProxy ziel : new java.util.ArrayList<>(ziele.keySet())) {
            if (nurMitVideo && !mitVideo.contains(ziel)) continue;
            try {
                ziel.postMessage(skript);
                erreicht += 1;
            } catch (Exception fehler) {
                // Der Rahmen ist weg - beim naechsten Laden meldet er sich neu.
                ziele.remove(ziel);
                mitVideo.remove(ziel);
            }
        }
        return erreicht;
    }

    /** Ob in diesem WebView ueberhaupt ein Rahmen mit Video bekannt ist. */
    public boolean hatSpieler(WebView ansicht) {
        Map<JavaScriptReplyProxy, String> ziele = rahmen.get(ansicht);
        if (ziele == null) return false;
        for (JavaScriptReplyProxy ziel : ziele.keySet()) {
            if (mitVideo.contains(ziel)) return true;
        }
        return false;
    }

    /**
     * Die bekannten Rahmen eines WebViews vergessen.
     *
     * <p>Beim Blaettern zur naechsten Folge sind die alten Rahmen tot; ihre
     * Kanaele wuerden sonst mitgezaehlt und die Skripte gingen ins Leere.
     */
    public void vergessen(WebView ansicht) {
        Map<JavaScriptReplyProxy, String> ziele = rahmen.remove(ansicht);
        if (ziele != null) mitVideo.removeAll(ziele.keySet());
    }
}
