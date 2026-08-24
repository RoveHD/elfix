package local.elflix.android;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Die volle Regelsprache auf Android - tsurlfilter, dieselbe Engine wie am Rechner.
 *
 * <p>Bis hierher konnte die APK genau eines: eine Domain sperren. Was in den
 * AdGuard-Listen sonst noch steht, war nicht zu haben - Regeln mit Pfad
 * ({@code ||wirt.de/ads/*}), mit Bedingung ({@code $script}, {@code $third-party},
 * {@code $domain=}), die Ausnahmen ({@code @@}), ueber die Captchas durchkommen,
 * und vor allem die kosmetischen Regeln, die genau die Schichten ausblenden,
 * gegen die ein Domainfilter nichts ausrichtet. Der Rechner hat das alles seit
 * dem Adblock-Umbau; das Telefon nicht.
 *
 * <p>Die Engine steht jetzt auch hier - im Kern, im selben WebView wie die
 * uebrige geteilte Logik, gebaut aus {@code adblock-engine.js}. Drei Dinge
 * machen das tragbar:
 *
 * <ol>
 *   <li><b>Sie laeuft nicht ueberall.</b> Eine Regelbasis dieser Groesse kostet
 *       dauerhaft ein paar hundert Megabyte. Auf einem Fernseh-Stick ist das
 *       nicht zu halten, und ein Renderer, dem der Speicher ausgeht, reisst den
 *       ganzen Kern mit. Also entscheidet {@link #geraetTraegt} - und wer will,
 *       ueberstimmt das in den Einstellungen.
 *   <li><b>Sie haelt niemanden auf.</b> {@code shouldInterceptRequest} ist
 *       synchron und laeuft im Netzfaden; der Kern antwortet asynchron ueber
 *       den Hauptfaden. Beides zusammenzuzwingen hiesse, den Netzverkehr auf
 *       die Oberflaeche warten zu lassen. Stattdessen beantwortet ein
 *       Zwischenspeicher, was die Engine schon einmal beurteilt hat, und was
 *       neu ist, geht als Stapel hinterher. Die erste Anfrage einer Adresse
 *       entscheidet also noch die Domainliste, jede weitere die Engine.
 *   <li><b>Sie ist nie die einzige Instanz.</b> Die Domainliste filtert
 *       weiter - vor dem Aufbau, waehrend er laeuft, und auf jedem Geraet, das
 *       die Engine nicht traegt.
 * </ol>
 */
public final class Werbefilter {
    private static final String TAG = CrashReporter.TAG;
    private static final String PREFS = "elflix_settings";
    /** "auto", "an" oder "aus" - was der Benutzer will. */
    static final String SCHLUESSEL_MODUS = "adblock_engine_modus";
    /** Ab wieviel Arbeitsspeicher ein Geraet die Engine von sich aus traegt. */
    private static final long SPEICHER_GRENZE = 3L * 1024 * 1024 * 1024;
    /** Wie lange gesammelt wird, bevor ein Stapel Fragen hinausgeht. */
    private static final long STAPEL_MS = 120;
    /** Wieviele Anfragen hoechstens in einen Stapel gehen. */
    private static final int STAPEL_GROESSE = 80;
    /** Wieviele Urteile behalten werden, bevor der Zwischenspeicher geleert wird. */
    private static final int SPEICHER_URTEILE = 20000;

    /** Wird gerufen, wenn sich der Zustand aendert - die Einstellungen zeichnen dann neu. */
    public interface Beobachter {
        void filterGeaendert();
    }

    private final Context context;
    private final Kern kern;
    private final Beobachter beobachter;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    /** Was die Engine ueber eine Anfrage gesagt hat: true = blocken, false = ausdruecklich erlaubt. */
    private final Map<String, Boolean> urteile = new ConcurrentHashMap<>();
    /** Was sie noch nicht gesehen hat. Wird im Netzfaden gefuellt, im Hauptfaden geleert. */
    private final ArrayDeque<String> offen = new ArrayDeque<>();

    private volatile boolean bereit;
    private boolean bauLaeuft;
    private volatile boolean stapelGeplant;
    private int regeln;
    private int listen;
    private String fehler = "";

    public Werbefilter(Context context, Kern kern, Beobachter beobachter) {
        this.context = context.getApplicationContext();
        this.kern = kern;
        this.beobachter = beobachter;
    }

    /* ----------------------------------------------------------- Zustand */

    public boolean istBereit() {
        return bereit;
    }

    /**
     * Ob dieses Geraet die Engine von sich aus tragen soll.
     *
     * <p>Zwei Fragen, beide vom System beantwortet: haelt Android das Geraet
     * selbst fuer knapp bei Speicher, und wieviel hat es ueberhaupt. Drei
     * Gigabyte sind kein gemessener Schwellwert, sondern eine vorsichtige
     * Grenze - darunter liegen die Fernseh-Sticks, und dort war der
     * Domainfilter schon immer der richtige Kompromiss.
     */
    static boolean geraetTraegt(Context context) {
        ActivityManager verwaltung = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        if (verwaltung == null) return false;
        if (verwaltung.isLowRamDevice()) return false;
        ActivityManager.MemoryInfo angaben = new ActivityManager.MemoryInfo();
        verwaltung.getMemoryInfo(angaben);
        return angaben.totalMem >= SPEICHER_GRENZE;
    }

    /** "auto", "an" oder "aus". */
    public String modus() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(SCHLUESSEL_MODUS, "auto");
    }

    public void setzeModus(String neu) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(SCHLUESSEL_MODUS, neu == null ? "auto" : neu).apply();
        if ("aus".equals(modus())) {
            bereit = false;
            urteile.clear();
            melde();
            return;
        }
        vorbereiten();
    }

    private boolean darfLaufen() {
        String modus = modus();
        if ("aus".equals(modus)) return false;
        if ("an".equals(modus)) return true;
        return geraetTraegt(context);
    }

    /** Was in den Einstellungen steht. */
    public String standText() {
        if (!darfLaufen()) {
            String grund = "aus".equals(modus())
                ? "Volle Regeln abgeschaltet."
                : "Volle Regeln aus: dieses Gerät hat zu wenig Speicher dafür.";
            return grund + " Es filtert die Domainliste: "
                + Adblocker.loadedAdGuardRuleCount() + " Domains.";
        }
        if (bereit) {
            return "Volle AdGuard-Regeln aktiv: " + regeln + " Regeln aus " + listen
                + (listen == 1 ? " Liste" : " Listen") + " - mit Pfaden, Bedingungen, Ausnahmen "
                + "und kosmetischen Regeln, genau wie am Rechner.";
        }
        if (bauLaeuft) return "Die vollen Regeln werden gerade aufgebaut.";
        if (!fehler.isEmpty()) {
            return "Volle Regeln nicht aufgebaut: " + fehler + ". Es filtert die Domainliste weiter.";
        }
        return "Volle Regeln noch nicht aufgebaut - dafür müssen die Filterlisten einmal geladen sein.";
    }

    /* ------------------------------------------------------------- Aufbau */

    /**
     * Die Engine bauen, wenn sie darf und wenn es etwas zu bauen gibt.
     *
     * <p>Nichts davon haelt den Start auf: bis sie steht, filtert die
     * Domainliste, und wenn sie nie steht, filtert die Domainliste weiter.
     */
    public void vorbereiten() {
        if (kern == null || !darfLaufen() || bauLaeuft) return;
        int[] vorhanden = Filterlisten.abgelegteListen(context);
        if (vorhanden.length == 0) {
            fehler = "";
            return;
        }
        JSONArray quellen = new JSONArray();
        try {
            for (int nummer : vorhanden) {
                JSONObject quelle = new JSONObject();
                quelle.put("id", nummer);
                quelle.put("url", Kern.LISTEN_WIRT + nummer + ".txt");
                quellen.put(quelle);
            }
        } catch (Exception ausnahme) {
            Log.e(TAG, "Filterquellen nicht gebaut", ausnahme);
            return;
        }
        bauLaeuft = true;
        melde();
        long start = System.currentTimeMillis();
        kern.rufe("adblock-bruecke.bauen", Kern.args(quellen), (wert, kernFehler) -> {
            bauLaeuft = false;
            if (kernFehler != null || wert == null) {
                fehler = kernFehler == null ? "keine Antwort" : kernFehler;
                Log.e(TAG, "Adblock-Engine nicht gebaut: " + fehler);
                melde();
                return;
            }
            try {
                JSONObject stand = new JSONObject(wert);
                bereit = stand.optBoolean("bereit", false);
                regeln = stand.optInt("regeln", 0);
                listen = stand.optInt("listen", 0);
                fehler = stand.optString("fehler", "");
            } catch (Exception ausnahme) {
                fehler = "Antwort unlesbar";
                Log.e(TAG, "Adblock-Zustand unlesbar", ausnahme);
            }
            Log.i(TAG, "Adblock-Engine: bereit=" + bereit + " regeln=" + regeln
                + " listen=" + listen + " in " + (System.currentTimeMillis() - start) + " ms"
                + (fehler.isEmpty() ? "" : " fehler=" + fehler));
            melde();
        });
    }

    /** Nach frisch geladenen Listen noch einmal bauen. */
    public void neuBauen() {
        bereit = false;
        urteile.clear();
        vorbereiten();
    }

    private void melde() {
        if (beobachter != null) haupt.post(beobachter::filterGeaendert);
    }

    /* ------------------------------------------------------------ Urteile */

    /**
     * Was die Engine ueber diese Anfrage sagt.
     *
     * <p>Laeuft im Netzfaden und darf deshalb nichts tun, was wartet.
     *
     * @return {@code TRUE} blocken, {@code FALSE} ausdruecklich erlaubt (eine
     *         {@code @@}-Regel), {@code null} noch kein Urteil - dann
     *         entscheidet die Domainliste, und die Engine sieht sich die
     *         Adresse gleich an.
     */
    public Boolean urteil(String url, String art, String quelle) {
        if (!bereit || url == null || url.isEmpty()) return null;
        String schluessel = schluessel(url, art, quelle);
        Boolean bekannt = urteile.get(schluessel);
        if (bekannt != null) return bekannt;
        vormerken(schluessel);
        return null;
    }

    /**
     * Der Schluessel eines Urteils.
     *
     * <p>Die Art und die Quelle gehoeren hinein: dieselbe Adresse wird von
     * {@code $script} anders beurteilt als von {@code $image}, und
     * {@code $third-party} haengt daran, von welcher Seite sie geholt wird.
     * Die Leerzeichen trennen - in keinem der drei Teile kommt eines vor.
     */
    private static String schluessel(String url, String art, String quelle) {
        return (art == null || art.isEmpty() ? "other" : art) + " "
            + (quelle == null ? "" : quelle) + " " + url;
    }

    private void vormerken(String schluessel) {
        synchronized (offen) {
            // Mehr als vier Stapel Rueckstand hiesse, dass die Seite schneller
            // fragt als die Engine antwortet. Dann ist der aelteste Eintrag
            // ohnehin laengst beantwortet worden oder nicht mehr von Belang.
            if (offen.size() > 4 * STAPEL_GROESSE) return;
            if (offen.contains(schluessel)) return;
            offen.add(schluessel);
        }
        // Nur wenn nicht ohnehin schon ein Stapel ansteht: sonst ginge je
        // Anfrage eine Aufgabe an den Hauptfaden, und auf einer werbelastigen
        // Seite waeren das Hunderte.
        if (!stapelGeplant) haupt.post(this::stapelPlanen);
    }

    private void stapelPlanen() {
        if (stapelGeplant) return;
        stapelGeplant = true;
        haupt.postDelayed(this::stapelFragen, STAPEL_MS);
    }

    private void stapelFragen() {
        stapelGeplant = false;
        if (!bereit || kern == null || !kern.istBereit()) return;
        List<String> stapel = new ArrayList<>(STAPEL_GROESSE);
        synchronized (offen) {
            while (!offen.isEmpty() && stapel.size() < STAPEL_GROESSE) stapel.add(offen.poll());
        }
        if (stapel.isEmpty()) return;

        JSONArray anfragen = new JSONArray();
        for (String schluessel : stapel) {
            String[] teile = schluessel.split(" ", 3);
            if (teile.length < 3) continue;
            try {
                JSONObject anfrage = new JSONObject();
                anfrage.put("typ", teile[0]);
                anfrage.put("quelle", teile[1]);
                anfrage.put("url", teile[2]);
                anfragen.put(anfrage);
            } catch (Exception ausnahme) {
                Log.e(TAG, "Anfrage nicht gebaut", ausnahme);
            }
        }
        if (anfragen.length() == 0) return;

        kern.rufe("adblock-bruecke.urteile", Kern.args(anfragen), (wert, kernFehler) -> {
            if (kernFehler == null && wert != null) uebernehmen(wert);
            // Was nicht in diesen Stapel gepasst hat, geht im naechsten.
            boolean nochWas;
            synchronized (offen) {
                nochWas = !offen.isEmpty();
            }
            if (nochWas) stapelPlanen();
        });
    }

    /**
     * Die Urteile eines Stapels uebernehmen.
     *
     * <p>Zugeordnet wird ueber die Angaben in der Antwort selbst und nicht
     * ueber die Reihenfolge: faellt eine Anfrage im Kern heraus, verschoebe
     * sich sonst alles dahinter um eins - und die Urteile landeten an fremden
     * Adressen. Das faellt niemandem auf, ausser als Seite, die nicht mehr
     * laedt.
     */
    private void uebernehmen(String wert) {
        try {
            JSONArray antwort = new JSONArray(wert);
            if (urteile.size() > SPEICHER_URTEILE) urteile.clear();
            for (int i = 0; i < antwort.length(); i += 1) {
                JSONObject urteil = antwort.optJSONObject(i);
                if (urteil == null) continue;
                boolean blocken = urteil.optBoolean("block", false);
                urteile.put(schluessel(urteil.optString("url"), urteil.optString("typ"),
                    urteil.optString("quelle")), blocken);
                if (blocken) {
                    Log.d(TAG, "Engine blockt " + urteil.optString("url")
                        + " (" + urteil.optString("regel") + ", Liste " + urteil.optInt("liste") + ")");
                }
            }
        } catch (Exception ausnahme) {
            Log.e(TAG, "Urteile unlesbar", ausnahme);
        }
    }

    /* ----------------------------------------------------------- Kosmetik */

    /**
     * Die kosmetischen Regeln dieser Seite einspielen.
     *
     * <p>Das ist der Teil, den ein Domainfilter grundsaetzlich nicht kann: die
     * Schicht ueber dem Player ist oft gar keine eigene Anfrage, sondern ein
     * paar DIVs, die ein laengst geladenes Skript einhaengt. Dagegen helfen nur
     * die {@code ##}-Regeln der Listen.
     *
     * <p>Was hineingeht, baut die Bruecke aus {@code adblock-kosmetik.js} -
     * demselben Modul, das am Rechner denselben Stil zusammensetzt.
     */
    public void seitenregelnEinspielen(WebView ansicht, Provider anbieter, String url) {
        if (!bereit || kern == null || ansicht == null || url == null || !url.startsWith("http")) return;
        if (anbieter != null && !anbieter.adblockEnabled) return;
        kern.rufe("adblock-bruecke.seitenregeln", Kern.args(url), (wert, kernFehler) -> {
            if (kernFehler != null || wert == null) return;
            try {
                JSONObject regeln = new JSONObject(wert);
                String stil = regeln.optString("stil", "");
                if (!stil.isEmpty()) ansicht.evaluateJavascript(stil, null);
                JSONArray skripte = regeln.optJSONArray("skripte");
                for (int i = 0; skripte != null && i < skripte.length(); i += 1) {
                    String skript = skripte.optString(i, "");
                    if (!skript.isEmpty()) ansicht.evaluateJavascript(skript, null);
                }
                int anzahl = regeln.optInt("selektoren", 0);
                if (anzahl > 0) {
                    Log.i(TAG, "Kosmetische Regeln eingespielt: " + anzahl + " Selektoren, "
                        + (skripte == null ? 0 : skripte.length()) + " Scriptlets");
                }
            } catch (Exception ausnahme) {
                Log.e(TAG, "Seitenregeln unlesbar", ausnahme);
            }
        });
    }

    /**
     * Die Art einer Anfrage, wie die Regelsprache sie kennt.
     *
     * <p>Android nennt sie nicht - {@code WebResourceRequest} kennt nur "ist es
     * der Hauptrahmen". Der Browser schickt sie aber selbst mit:
     * {@code Sec-Fetch-Dest} steht in den Anfragen heutiger WebViews und sagt,
     * wofuer die Antwort gedacht ist. Ohne diese Angabe waere jede Regel mit
     * {@code $script} oder {@code $image} wertlos - und dann waere von der
     * vollen Regelsprache wieder nur der Domainteil uebrig.
     */
    public static String artAus(Map<String, String> kopfzeilen, boolean hauptrahmen, String url) {
        if (hauptrahmen) return "mainFrame";
        String ziel = null;
        if (kopfzeilen != null) {
            for (Map.Entry<String, String> eintrag : kopfzeilen.entrySet()) {
                if (eintrag.getKey() == null) continue;
                if (!"sec-fetch-dest".equalsIgnoreCase(eintrag.getKey())) continue;
                ziel = eintrag.getValue();
                break;
            }
        }
        if (ziel != null) {
            switch (ziel) {
                case "script": return "script";
                case "style": return "stylesheet";
                case "image": return "image";
                case "font": return "font";
                case "iframe":
                case "frame": return "subFrame";
                case "document": return "mainFrame";
                case "video":
                case "audio":
                case "track": return "media";
                case "object":
                case "embed": return "object";
                case "empty": return "xhr";
                default: break;
            }
        }
        return artAusAdresse(url);
    }

    /** Der Rueckfall: die Endung. Aeltere WebViews schicken kein Sec-Fetch-Dest. */
    private static String artAusAdresse(String url) {
        String pfad = url == null ? "" : url.toLowerCase();
        int frage = pfad.indexOf('?');
        if (frage > 0) pfad = pfad.substring(0, frage);
        if (pfad.endsWith(".js") || pfad.endsWith(".mjs")) return "script";
        if (pfad.endsWith(".css")) return "stylesheet";
        if (pfad.endsWith(".png") || pfad.endsWith(".jpg") || pfad.endsWith(".jpeg")
            || pfad.endsWith(".gif") || pfad.endsWith(".webp") || pfad.endsWith(".svg")
            || pfad.endsWith(".ico")) {
            return "image";
        }
        if (pfad.endsWith(".woff") || pfad.endsWith(".woff2") || pfad.endsWith(".ttf")) return "font";
        if (pfad.endsWith(".mp4") || pfad.endsWith(".m3u8") || pfad.endsWith(".ts")
            || pfad.endsWith(".webm") || pfad.endsWith(".mp3")) {
            return "media";
        }
        return "other";
    }
}
