package local.elflix.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Der gemeinsame Kern: die Geschaeftslogik der Desktop-App, hier ausgefuehrt.
 *
 * <p>Bis hierher hatte Android die Regeln von ELFIX ein zweites Mal - in Java,
 * von Hand nachgezogen. Gemessen: 37 Funktionen mit denselben Namen wie in
 * {@code main.js}, dazu {@code Provider.java} als Abschrift von
 * {@code provider-model.js}. Zwei Abschriften derselben Regel laufen
 * auseinander, sobald nur eine gepflegt wird, und genau das war passiert.
 *
 * <p>Statt weiter abzuschreiben laedt diese Klasse die Original-Module in einen
 * unsichtbaren {@link WebView}. Sie brauchen kein Electron und kein Node,
 * sondern nur {@code fetch}, {@code WebSocket} und {@code setTimeout} - alles
 * vorhanden. Der Kopierschritt beim Bauen (siehe {@code app/build.gradle})
 * sorgt dafuer, dass immer dieselbe Fassung laeuft wie am Desktop.
 *
 * <p>Alle oeffentlichen Methoden sind vom Hauptthread aufzurufen; die Antworten
 * kommen ebenfalls dort an.
 */
public final class Kern {
    private static final String TAG = CrashReporter.TAG;
    private static final String SEITE = "file:///android_asset/kern/kern.html";
    private static final String MODULE_ORDNER = "kern/module";
    /**
     * Android-eigene Ergaenzungen im Kern.
     *
     * <p>Hier steht nur Verkabelung - was am Rechner in main.js liegt und dort
     * an Electron haengt. Geschaeftslogik gehoert nicht hierher, sondern nach
     * {@code kern/module}, damit beide Geraete sie teilen.
     */
    private static final String EIGEN_ORDNER = "kern/eigen";
    /**
     * Unter dieser Adresse liefert der Kern die Filterlisten an sich selbst aus.
     *
     * <p>Sie geht nie ins Netz: {@link #listeAusliefern} faengt sie ab und
     * reicht die Datei von der Platte durch. Der Umweg ueber eine Adresse ist
     * Absicht - die Listen sind mehrere Megabyte gross, und die Bruecke
     * (evaluateJavascript) traegt Antworten als Text in einem einzigen Aufruf.
     * So streamt der WebView sie stattdessen selbst, ohne dass ein Byte durch
     * die Bruecke muss.
     */
    static final String LISTEN_WIRT = "https://elfix.listen/";
    /** Ein Abruf ueber Java, damit die Anbieter-Kekse mitgehen und CORS nicht im Weg steht. */
    private static final int NETZ_TIMEOUT_MS = 20_000;
    private static final String NETZ_AGENT =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

    /** Ergebnis eines Kern-Aufrufs. Genau eine der beiden Seiten ist gesetzt. */
    public interface Antwort {
        void fertig(String wertJson, String fehler);
    }

    /** Was der Kern von sich aus meldet - Watchparty-Zustaende etwa. */
    public interface Horcher {
        void ereignis(String name, String nutzlastJson);
    }

    private final Context context;
    private final Horcher horcher;
    private final Handler haupt = new Handler(Looper.getMainLooper());
    private final ExecutorService netz = Executors.newFixedThreadPool(4);
    private final Map<String, Antwort> offeneAufrufe = new ConcurrentHashMap<>();
    private final AtomicLong zaehler = new AtomicLong();
    private final List<Runnable> nachStart = new ArrayList<>();

    private WebView webView;
    private boolean bereit;
    private String startFehler;

    public Kern(Context context, Horcher horcher) {
        this.context = context.getApplicationContext();
        this.horcher = horcher;
    }

    /** Ob der Kern Aufrufe schon selbst beantwortet. Vorher werden sie gepuffert. */
    public boolean istBereit() {
        return bereit;
    }

    /** Warum der Kern nicht hochkam, oder {@code null}, solange alles in Ordnung ist. */
    public String startFehler() {
        return startFehler;
    }

    /**
     * Fuehrt etwas aus, sobald der Kern steht - oder sofort, wenn er es schon
     * tut. Der Start dauert einen Wimpernschlag; die Oberflaeche ist frueher
     * da und soll deswegen nicht auf ihn warten muessen.
     */
    public void wennBereit(Runnable aufgabe) {
        if (aufgabe == null) return;
        if (bereit) aufgabe.run();
        else nachStart.add(aufgabe);
    }

    @SuppressLint("SetJavaScriptEnabled")
    public void starten() {
        if (webView != null) return;
        try {
            webView = new WebView(context);
        } catch (Throwable schwer) {
            // Ohne WebView gibt es kein ELFIX - aber der Absturz gehoert hierhin
            // gemeldet und nicht in einen leeren Bildschirm.
            startFehler = "WebView nicht verfuegbar: " + schwer;
            Log.e(TAG, startFehler, schwer);
            return;
        }
        WebSettings einstellungen = webView.getSettings();
        einstellungen.setJavaScriptEnabled(true);
        einstellungen.setDomStorageEnabled(true);
        einstellungen.setUserAgentString(NETZ_AGENT);
        // Der Kern zeigt nichts an; er darf trotzdem nicht wegen fehlender
        // Groesse angehalten werden, deshalb bleibt er im Baum der Activity.
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                moduleEinspielen();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest anfrage, WebResourceError fehler) {
                if (anfrage != null && anfrage.isForMainFrame()) {
                    startFehler = "Kern-Seite lud nicht: " + fehler.getDescription();
                    Log.e(TAG, startFehler);
                }
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest anfrage) {
                return listeAusliefern(anfrage);
            }

            /**
             * Der Kern ist gestorben - meist, weil der Renderer keinen
             * Speicher mehr hatte.
             *
             * <p>Ohne diese Stelle waere das ein stiller Ausfall: der WebView
             * ist weg, jeder weitere Aufruf ginge ins Leere, und jeder offene
             * bliebe fuer immer offen. Die Oberflaeche wartete dann auf
             * Antworten, die niemand mehr gibt.
             *
             * <p>Also: alle offenen Aufrufe scheitern lassen und den Kern neu
             * hochziehen. Was er haelt, ist wiederherstellbar - die Regel
             * steht in den Modulen, der Bestand in der Ablage.
             */
            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail hinweis) {
                Log.e(TAG, "Kern-WebView gestorben (abgestuerzt: "
                    + (hinweis != null && hinweis.didCrash()) + ") - wird neu gestartet");
                neuStarten();
                return true;
            }
        });
        webView.addJavascriptInterface(new Bruecke(), "AndroidKern");
        // Die Krypto-Grundrechenarten. Eigene Bruecke, weil sie nichts mit dem
        // Kern zu tun haben: sie kennen keinen Aufruf, keine Antwort und keinen
        // Zustand - sie rechnen. Was damit geschieht, entscheidet ausschliesslich
        // geraete-schluessel.js.
        webView.addJavascriptInterface(new Krypto(), "AndroidKrypto");
        webView.loadUrl(SEITE);
    }

    /**
     * Eine Filterliste an den Kern selbst ausliefern.
     *
     * <p>Nur unter {@link #LISTEN_WIRT} und nur ein Dateiname aus Ziffern -
     * damit hier kein Pfad hereinkommt, der irgendwohin sonst zeigt.
     *
     * <p>Der Kopf {@code Access-Control-Allow-Origin} muss sein: die Kern-Seite
     * kommt aus dem Paket und hat damit gar keinen Ursprung, den ein Browser
     * als denselben ansieht. Ohne ihn duerfte das Skript die Antwort nicht
     * lesen, obwohl sie aus der eigenen App kommt.
     */
    private WebResourceResponse listeAusliefern(WebResourceRequest anfrage) {
        if (anfrage == null || anfrage.getUrl() == null) return null;
        String adresse = anfrage.getUrl().toString();
        if (!adresse.startsWith(LISTEN_WIRT)) return null;
        String name = adresse.substring(LISTEN_WIRT.length());
        if (!name.matches("\\d{1,4}\\.txt")) return null;
        File datei = new File(new File(context.getFilesDir(), Filterlisten.ROH_ORDNER), name);
        Map<String, String> kopf = new java.util.HashMap<>();
        kopf.put("Access-Control-Allow-Origin", "*");
        kopf.put("Cache-Control", "no-store");
        try {
            if (!datei.isFile()) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Nicht da", kopf,
                    new java.io.ByteArrayInputStream(new byte[0]));
            }
            return new WebResourceResponse("text/plain", "utf-8", 200, "OK", kopf,
                new java.io.FileInputStream(datei));
        } catch (Exception fehler) {
            Log.e(TAG, "Filterliste nicht ausgeliefert: " + name, fehler);
            return null;
        }
    }

    /**
     * Den Kern noch einmal hochziehen.
     *
     * <p>Wer auf eine Antwort wartet, bekommt einen Fehler statt ewiger Stille -
     * das ist der Unterschied zwischen "hat nicht geklappt" und "haengt".
     */
    private void neuStarten() {
        bereit = false;
        for (String id : new java.util.ArrayList<>(offeneAufrufe.keySet())) {
            melde(id, null, "Kern wurde neu gestartet");
        }
        if (webView != null) {
            try {
                webView.destroy();
            } catch (Exception fehler) {
                Log.e(TAG, "Alten Kern nicht abgeraeumt", fehler);
            }
            webView = null;
        }
        starten();
    }

    public void beenden() {
        netz.shutdownNow();
        if (webView == null) return;
        webView.removeJavascriptInterface("AndroidKern");
        webView.destroy();
        webView = null;
        bereit = false;
    }

    /**
     * Ruft eine Ausfuhr eines Kern-Moduls auf, etwa {@code "titel.werkSchluessel"}.
     *
     * <p>Gibt die Funktion ein Promise zurueck, kommt die Antwort erst, wenn es
     * sich aufgeloest hat - der Aufrufer merkt keinen Unterschied.
     */
    public void rufe(String pfad, JSONArray argumente, Antwort antwort) {
        String id = "a" + zaehler.incrementAndGet();
        if (antwort != null) offeneAufrufe.put(id, antwort);
        String args = argumente == null ? "[]" : argumente.toString();
        String skript = "ElfixKern.aufruf("
            + JSONObject.quote(id) + "," + JSONObject.quote(pfad) + "," + JSONObject.quote(args) + ")";
        fuehreAus(skript, id);
    }

    /** Wie {@link #rufe}, aber ohne Argumente. */
    public void rufe(String pfad, Antwort antwort) {
        rufe(pfad, new JSONArray(), antwort);
    }

    /** Baut eine Argumentliste. Bequemer als jedes Mal ein {@link JSONArray} zu fuellen. */
    public static JSONArray args(Object... werte) {
        JSONArray liste = new JSONArray();
        for (Object wert : werte) liste.put(wert == null ? JSONObject.NULL : wert);
        return liste;
    }

    /**
     * Faehrt die Faelle aus {@code kern/fortschritt-proben.json} durch die
     * geteilte Regel und meldet, ob dasselbe herauskommt wie am Rechner.
     *
     * <p>Dass beide Seiten dieselbe Datei laden, heisst noch nicht, dass beide
     * dasselbe rechnen: hier laeuft ein WebView, dort Node. Ein anderes
     * Zahlenformat oder eine andere Zeitzone genuegte fuer einen Unterschied,
     * den sonst erst der Benutzer bemerkt - an einem Stand, der nicht passt.
     * Dieselben Faelle stehen in {@code tests/fortschritttest.js}.
     */
    /**
     * Ein Textwert aus einer Kern-Antwort.
     *
     * <p>Die Antworten kommen als JSON-Text herein; eine Zeichenkette steht
     * darin in Anfuehrungszeichen und mit maskierten Sonderzeichen. Das hier
     * macht daraus wieder den Text - eine Stelle, damit nicht jeder Aufrufer
     * seine eigene halbe Loesung dafuer mitbringt.
     */
    public static String text(String jsonWert) {
        String text = jsonWert == null ? "" : jsonWert.trim();
        if (text.isEmpty() || "null".equals(text)) return "";
        if (text.length() >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
            try {
                return new JSONArray("[" + text + "]").getString(0);
            } catch (Exception ignoriert) {
                return text.substring(1, text.length() - 1);
            }
        }
        return text;
    }

    public void probenFahren(Antwort antwort) {
        String roh = assetLesen("kern/fortschritt-proben.json");
        if (roh == null) {
            haupt.post(() -> antwort.fertig(null, "Probenliste fehlt im Paket"));
            return;
        }
        try {
            JSONArray argumente = new JSONArray().put(new JSONObject(roh));
            rufe("fortschritt-proben.pruefen", argumente, (wert, fehler) -> {
                if (fehler != null) {
                    antwort.fertig(null, fehler);
                    return;
                }
                try {
                    JSONObject bericht = new JSONObject(wert);
                    String zeile = bericht.optString("zeile", wert);
                    boolean vollstaendig = bericht.optInt("bestanden") == bericht.optInt("gesamt")
                        && bericht.optInt("gesamt") > 0;
                    antwort.fertig(zeile, vollstaendig ? null : "Proben weichen ab: " + zeile);
                } catch (Exception ausnahme) {
                    antwort.fertig(wert, null);
                }
            });
        } catch (Exception fehler) {
            haupt.post(() -> antwort.fertig(null, "Probenliste unlesbar: " + fehler));
        }
    }

    private void fuehreAus(String skript, String rufId) {
        if (webView == null) {
            melde(rufId, null, startFehler == null ? "Kern wurde nicht gestartet" : startFehler);
            return;
        }
        if (Looper.myLooper() == Looper.getMainLooper()) {
            webView.evaluateJavascript(skript, null);
        } else {
            haupt.post(() -> {
                if (webView != null) webView.evaluateJavascript(skript, null);
                else melde(rufId, null, "Kern wurde beendet");
            });
        }
    }

    private void melde(String id, String wertJson, String fehler) {
        Antwort antwort = offeneAufrufe.remove(id);
        if (antwort == null) return;
        haupt.post(() -> antwort.fertig(wertJson, fehler));
    }

    /**
     * Schiebt die Modul-Quelltexte in die Seite und startet den Kern.
     *
     * <p>Jedes Modul geht einzeln hinueber. Ein einziger Aufruf mit allen
     * zusammen waere bequemer, liefe aber in die Groessengrenze, die Android
     * zwischen den Prozessen zieht - und ein Modul, das dabei abgeschnitten
     * wuerde, faellt erst beim Benutzen auf.
     */
    private void moduleEinspielen() {
        if (webView == null || bereit) return;
        // Zuerst die geteilten Module, dann die Android-eigenen: letztere
        // bauen auf ersteren auf. Die Reihenfolge des Einspielens ist zwar
        // gleichgueltig - geladen wird erst beim ersten require -, aber sie
        // sagt, was wovon abhaengt.
        if (!ordnerEinspielen(MODULE_ORDNER, true)) return;
        ordnerEinspielen(EIGEN_ORDNER, false);
        webView.evaluateJavascript("ElfixKern.start()", null);
    }

    /**
     * @param noetig ob ein leerer Ordner ein Fehler ist - die geteilten Module
     *               muessen da sein, eigene Ergaenzungen duerfen fehlen
     */
    private boolean ordnerEinspielen(String ordner, boolean noetig) {
        String[] dateien;
        try {
            dateien = context.getAssets().list(ordner);
        } catch (Exception fehler) {
            if (noetig) {
                startFehler = "Kern-Module nicht lesbar: " + fehler;
                Log.e(TAG, startFehler, fehler);
            }
            return !noetig;
        }
        if (dateien == null || dateien.length == 0) {
            if (noetig) {
                startFehler = "Kern-Module fehlen im Paket";
                Log.e(TAG, startFehler);
                return false;
            }
            return true;
        }
        Arrays.sort(dateien);
        for (String datei : dateien) {
            if (!datei.endsWith(".js")) continue;
            String quelle = assetLesen(ordner + "/" + datei);
            if (quelle == null) {
                startFehler = "Kern-Modul unlesbar: " + datei;
                Log.e(TAG, startFehler);
                return false;
            }
            webView.evaluateJavascript(
                "ElfixKern.quelle(" + JSONObject.quote(datei) + "," + JSONObject.quote(quelle) + ")", null);
        }
        return true;
    }

    private String assetLesen(String pfad) {
        try (InputStream strom = context.getAssets().open(pfad)) {
            ByteArrayOutputStream puffer = new ByteArrayOutputStream(Math.max(1024, strom.available()));
            byte[] block = new byte[8192];
            int gelesen;
            while ((gelesen = strom.read(block)) > 0) puffer.write(block, 0, gelesen);
            return puffer.toString(StandardCharsets.UTF_8.name());
        } catch (Exception fehler) {
            Log.e(TAG, "Kern-Asset " + pfad + " nicht lesbar", fehler);
            return null;
        }
    }

    /* ------------------------------------------------------------ Bruecke */

    private final class Bruecke {
        @JavascriptInterface
        public void bereit(String moduleJson) {
            haupt.post(() -> {
                bereit = true;
                Log.i(TAG, "Kern bereit: " + moduleJson);
                for (Runnable aufgabe : nachStart) aufgabe.run();
                nachStart.clear();
            });
        }

        @JavascriptInterface
        public void antwort(String id, String ergebnisJson) {
            String wert = null;
            String fehler = null;
            try {
                JSONObject ergebnis = new JSONObject(ergebnisJson);
                if (ergebnis.optBoolean("ok")) {
                    // Der Wert reist als Text weiter: er kann Objekt, Feld,
                    // Zahl oder null sein, und der Aufrufer weiss selbst, was
                    // er erwartet.
                    wert = ergebnis.isNull("wert") ? "null" : rohWert(ergebnis);
                } else {
                    fehler = ergebnis.optString("fehler", "Unbekannter Fehler im Kern");
                }
            } catch (Exception ausnahme) {
                fehler = "Antwort des Kerns unlesbar: " + ausnahme;
            }
            melde(id, wert, fehler);
        }

        @JavascriptInterface
        public void ereignis(String name, String nutzlastJson) {
            if (horcher == null) return;
            haupt.post(() -> horcher.ereignis(name, nutzlastJson));
        }

        @JavascriptInterface
        public void protokoll(String stufe, String text) {
            if ("fehler".equals(stufe)) Log.e(TAG, "Kern: " + text);
            else Log.i(TAG, "Kern: " + text);
        }

        @JavascriptInterface
        public void netzStart(String id, String url, String optionenJson) {
            netz.execute(() -> netzAusfuehren(id, url, optionenJson));
        }
    }

    private static String rohWert(JSONObject ergebnis) {
        Object wert = ergebnis.opt("wert");
        if (wert instanceof JSONObject || wert instanceof JSONArray) return wert.toString();
        if (wert instanceof String) return JSONObject.quote((String) wert);
        return String.valueOf(wert);
    }

    /* --------------------------------------------------------------- Netz */

    /**
     * Der Abruf, den der Kern statt des eigenen {@code fetch} benutzt.
     *
     * <p>Zwei Gruende, warum das nicht im WebView bleiben kann: die Kern-Seite
     * hat einen eigenen Ursprung, also waere jede Anbieterseite fremd und die
     * Antwort nicht lesbar - und ohne die Kekse der laufenden Anbieter-Sitzung
     * kaeme ohnehin nur die Anmeldeseite zurueck. Der Hauptprozess am Desktop
     * holt aus genau denselben Gruenden ueber die Sitzung des Anbieters.
     */
    private void netzAusfuehren(String id, String adresse, String optionenJson) {
        JSONObject antwort = new JSONObject();
        HttpURLConnection verbindung = null;
        try {
            JSONObject optionen = new JSONObject(optionenJson == null ? "{}" : optionenJson);
            URL url = new URL(adresse);
            verbindung = (HttpURLConnection) url.openConnection();
            verbindung.setRequestMethod(optionen.optString("methode", "GET"));
            verbindung.setConnectTimeout(NETZ_TIMEOUT_MS);
            verbindung.setReadTimeout(NETZ_TIMEOUT_MS);
            verbindung.setInstanceFollowRedirects(true);
            verbindung.setRequestProperty("User-Agent", NETZ_AGENT);
            verbindung.setRequestProperty("Accept-Language", "de-DE,de;q=0.9,en;q=0.8");

            String kekse = CookieManager.getInstance().getCookie(adresse);
            if (kekse != null && !kekse.isEmpty()) verbindung.setRequestProperty("Cookie", kekse);

            JSONObject kopf = optionen.optJSONObject("kopf");
            if (kopf != null) {
                for (java.util.Iterator<String> namen = kopf.keys(); namen.hasNext(); ) {
                    String name = namen.next();
                    verbindung.setRequestProperty(name, kopf.optString(name));
                }
            }

            String koerper = optionen.isNull("koerper") ? null : optionen.optString("koerper", null);
            if (koerper != null) {
                verbindung.setDoOutput(true);
                try (OutputStream aus = verbindung.getOutputStream()) {
                    aus.write(koerper.getBytes(StandardCharsets.UTF_8));
                }
            }

            int status = verbindung.getResponseCode();
            InputStream strom = status >= 400 ? verbindung.getErrorStream() : verbindung.getInputStream();
            String text = strom == null ? "" : stromLesen(strom);

            JSONObject kopfzeilen = new JSONObject();
            for (Map.Entry<String, List<String>> eintrag : verbindung.getHeaderFields().entrySet()) {
                if (eintrag.getKey() == null || eintrag.getValue() == null || eintrag.getValue().isEmpty()) continue;
                kopfzeilen.put(eintrag.getKey(), eintrag.getValue().get(0));
            }
            // Was der Anbieter an Keksen setzt, gehoert in dieselbe Ablage, aus
            // der die Anbieter-WebViews lesen - sonst laeuft die Sitzung des
            // Kerns neben der des Browsers her.
            List<String> gesetzt = verbindung.getHeaderFields().get("Set-Cookie");
            if (gesetzt != null) {
                for (String keks : gesetzt) CookieManager.getInstance().setCookie(adresse, keks);
            }

            antwort.put("status", status);
            antwort.put("statusText", verbindung.getResponseMessage() == null ? "" : verbindung.getResponseMessage());
            antwort.put("url", verbindung.getURL().toString());
            antwort.put("umgeleitet", !verbindung.getURL().toString().equals(adresse));
            antwort.put("kopf", kopfzeilen);
            antwort.put("koerper", text);
        } catch (Exception fehler) {
            try {
                antwort = new JSONObject().put("fehler", String.valueOf(fehler.getMessage() == null ? fehler : fehler.getMessage()));
            } catch (Exception ignoriert) {
                // Ein JSONObject mit einem einzigen Textfeld kann nicht scheitern.
            }
        } finally {
            if (verbindung != null) verbindung.disconnect();
        }
        String nutzlast = antwort.toString();
        haupt.post(() -> {
            if (webView == null) return;
            webView.evaluateJavascript(
                "ElfixKern.netzFertig(" + JSONObject.quote(id) + "," + JSONObject.quote(nutzlast) + ")", null);
        });
    }

    private static String stromLesen(InputStream strom) throws Exception {
        try (InputStream offen = strom) {
            ByteArrayOutputStream puffer = new ByteArrayOutputStream(16384);
            byte[] block = new byte[8192];
            int gelesen;
            while ((gelesen = offen.read(block)) > 0) puffer.write(block, 0, gelesen);
            return puffer.toString(StandardCharsets.UTF_8.name());
        }
    }
}
