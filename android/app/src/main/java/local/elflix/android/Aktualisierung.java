package local.elflix.android;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Sich selbst auf den neuesten Stand bringen.
 *
 * <p>ELFIX kommt aus keinem Laden. Am Rechner erledigt das {@code
 * electron-updater} gegen dieselben GitHub-Releases; hier stand bisher nichts,
 * und jede neue Fassung hiess: Datei suchen, herunterladen, installieren - und
 * weil die alten APKs bei jedem Bau eine andere Unterschrift trugen, vorher
 * deinstallieren und dabei alles verlieren, was auf dem Geraet stand.
 *
 * <p>Der Ablauf hier ist derselbe wie am Rechner, bis auf den letzten Schritt:
 * beim Start still nachsehen, im Hintergrund holen, dann einmal fragen.
 * Installiert wird nie von allein - das kann eine App auf Android auch gar
 * nicht. Der Paketinstaller fragt selbst noch einmal, und das ist gut so.
 *
 * <p><b>Was nach draussen geht:</b> eine Anfrage an die oeffentliche
 * GitHub-API und, wenn wirklich etwas Neues da ist, das Herunterladen der
 * Datei. Kein Konto, keine Kennung, nichts ueber das Geraet - die Anfrage
 * sieht aus wie jede andere auf diese Seite.
 */
public final class Aktualisierung {
    private static final String TAG = CrashReporter.TAG;

    /**
     * Dieselben Releases wie am Rechner.
     *
     * <p>Das Repository ist oeffentlich, also braucht dieser Abruf kein Konto
     * und keinen Zugriffsschluessel. Waere es das nicht, ginge dieser Weg gar
     * nicht - ein Schluessel in einer APK ist keiner.
     */
    private static final String NEUESTE =
        "https://api.github.com/repos/RoveHD/elfix/releases/latest";

    private static final String PREFS = "elflix_settings";
    private static final String ZULETZT_GESEHEN = "fassung_zuletzt_gesehen";
    private static final String UEBERSPRUNGEN = "fassung_uebersprungen";

    /**
     * So oft wird von selbst nachgesehen.
     *
     * <p>Bei jedem Start waere es oefter als noetig - ELFIX wird am Tag
     * mehrmals geoeffnet, und Releases kommen nicht stuendlich. Der Knopf in
     * den Einstellungen fragt trotzdem sofort: wer ihn drueckt, will jetzt
     * wissen, woran er ist.
     */
    private static final long ABSTAND_MS = 6 * 60 * 60 * 1000L;
    private static final int NETZ_TIMEOUT_MS = 20000;
    /** Der Ordner aus res/xml/dateiwege.xml - der einzige, den ELFIX herausreicht. */
    private static final String ORDNER = "fassungen";

    /** Wo der Abgleich mit den Releases gerade steht. */
    public enum Lage {
        /** Noch nicht nachgesehen. */
        RUHT,
        SUCHT,
        /** Es gibt nichts Neueres. */
        AKTUELL,
        /** Es gibt etwas Neueres, es wird geholt. */
        LAEDT,
        /** Die Datei liegt da und wartet auf ein Ja. */
        BEREIT,
        FEHLER
    }

    /** Was die Oberflaeche davon erfaehrt. */
    public interface Horcher {
        void fassungGeaendert();
    }

    /** Wird gerufen, wenn eine geholte Fassung bereitliegt - genau einmal je Fassung. */
    public interface Frager {
        void fragen(String fassung);
    }

    private final Context context;
    private final Horcher horcher;
    private final Handler haupt = new Handler(Looper.getMainLooper());
    // Ein einziger Faden: Nachsehen und Herunterladen sollen sich nicht in die
    // Quere kommen, und beides eilt nicht.
    private final ExecutorService faden = Executors.newSingleThreadExecutor();

    private Lage lage = Lage.RUHT;
    private String neueFassung = "";
    private String adresse = "";
    private long umfang = 0;
    private int fortschritt = 0;
    private String fehler = "";
    private File datei;
    private boolean laeuft = false;
    private Frager frager;
    /** Ob zu dieser Fassung schon gefragt wurde. Zweimal fragen ist Draengeln. */
    private String gefragtZu = "";

    public Aktualisierung(Context context, Horcher horcher) {
        this.context = context.getApplicationContext();
        this.horcher = horcher;
    }

    public void setzeFrager(Frager frager) {
        this.frager = frager;
    }

    // --- Was die Oberflaeche fragt -------------------------------------------

    public Lage lage() {
        return lage;
    }

    public String neueFassung() {
        return neueFassung;
    }

    public int fortschritt() {
        return fortschritt;
    }

    public String fehler() {
        return fehler;
    }

    /** Die Fassung, die gerade laeuft - aus dem Paket, nicht aus einer Konstanten. */
    public String eigeneFassung() {
        try {
            String name = context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0).versionName;
            return name == null ? "" : name;
        } catch (Exception fehler) {
            return "";
        }
    }

    // --- Nachsehen ------------------------------------------------------------

    /**
     * Beim Start nachsehen - aber nicht bei jedem.
     *
     * @param vonHand ob jemand den Knopf gedrueckt hat. Dann wird sofort
     *                nachgesehen, und eine uebersprungene Fassung zaehlt wieder.
     */
    public void nachsehen(boolean vonHand) {
        if (laeuft) return;
        if (!vonHand && System.currentTimeMillis() - zuletztGesehen() < ABSTAND_MS) return;
        if (vonHand) einstellungen().edit().remove(UEBERSPRUNGEN).apply();

        laeuft = true;
        melde(Lage.SUCHT);
        faden.execute(() -> {
            try {
                JSONObject release = new JSONObject(holen(NEUESTE, "application/vnd.github+json"));
                // "v1.38.0" ist der Tag, "1.38.0" die Fassung. Der Rest der App
                // kennt nur die zweite Form.
                String fassung = release.optString("tag_name", "").replaceFirst("^[vV]", "");
                String ziel = apkAdresse(release.optJSONArray("assets"));
                long groesse = apkUmfang(release.optJSONArray("assets"));

                einstellungen().edit().putLong(ZULETZT_GESEHEN, System.currentTimeMillis()).apply();

                if (fassung.isEmpty() || ziel.isEmpty()) {
                    // Ein Release ohne APK ist kein Fehler dieses Geraets - es
                    // gibt dort schlicht nichts fuer Android.
                    haupt.post(() -> fertig(Lage.AKTUELL, ""));
                    return;
                }
                if (vergleichen(fassung, eigeneFassung()) <= 0) {
                    haupt.post(() -> fertig(Lage.AKTUELL, ""));
                    return;
                }
                haupt.post(() -> {
                    neueFassung = fassung;
                    adresse = ziel;
                    umfang = groesse;
                    laden();
                });
            } catch (Exception ausnahme) {
                Log.w(TAG, "Nach neuer Fassung sehen fehlgeschlagen: " + ausnahme);
                haupt.post(() -> fertig(Lage.FEHLER, String.valueOf(ausnahme.getMessage())));
            }
        });
    }

    /**
     * Die Datei holen.
     *
     * <p>Erst daneben, dann umbenennen - dieselbe Vorsicht wie bei jeder
     * anderen Ablage hier. Eine halb geladene APK, die wie eine fertige heisst,
     * waere ein Installationsversuch, der nur scheitern kann.
     */
    private void laden() {
        File fertig = new File(ordner(), "ELFIX-" + neueFassung + ".apk");
        // Schon geholt? Dann nicht noch einmal - etwa, weil beim letzten Mal
        // "Spaeter" gesagt wurde.
        if (fertig.isFile() && (umfang <= 0 || fertig.length() == umfang)) {
            datei = fertig;
            fertig(Lage.BEREIT, "");
            fragenWennNoetig();
            return;
        }

        fortschritt = 0;
        melde(Lage.LAEDT);
        faden.execute(() -> {
            File zwischen = new File(ordner(), "ELFIX-" + neueFassung + ".apk.teil");
            HttpURLConnection verbindung = null;
            try {
                verbindung = verbinden(adresse, "application/octet-stream");
                long gesamt = umfang > 0 ? umfang : verbindung.getContentLength();
                try (InputStream herein = verbindung.getInputStream();
                     FileOutputStream hinaus = new FileOutputStream(zwischen)) {
                    byte[] block = new byte[64 * 1024];
                    long gelesen = 0;
                    int schritt;
                    int gemeldet = -1;
                    while ((schritt = herein.read(block)) > 0) {
                        hinaus.write(block, 0, schritt);
                        gelesen += schritt;
                        if (gesamt <= 0) continue;
                        int prozent = (int) Math.min(100, gelesen * 100 / gesamt);
                        // Nicht bei jedem Block melden: das waeren tausend
                        // Neuzeichnungen fuer eine Zahl, die sich nicht aendert.
                        if (prozent == gemeldet) continue;
                        gemeldet = prozent;
                        haupt.post(() -> {
                            fortschritt = prozent;
                            melde(Lage.LAEDT);
                        });
                    }
                    hinaus.getFD().sync();
                }
                if (!zwischen.renameTo(fertig) && !(fertig.delete() && zwischen.renameTo(fertig))) {
                    throw new Exception("Die geladene Datei liess sich nicht ablegen");
                }
                aeltereWegraeumen(fertig);
                haupt.post(() -> {
                    datei = fertig;
                    fortschritt = 100;
                    fertig(Lage.BEREIT, "");
                    fragenWennNoetig();
                });
            } catch (Exception ausnahme) {
                Log.w(TAG, "Neue Fassung nicht geladen: " + ausnahme);
                zwischen.delete();
                haupt.post(() -> fertig(Lage.FEHLER, String.valueOf(ausnahme.getMessage())));
            } finally {
                if (verbindung != null) verbindung.disconnect();
            }
        });
    }

    /**
     * Einmal fragen, und nur einmal.
     *
     * <p>Wer "Spaeter" sagt, hat es gesagt. Die Fassung bleibt in den
     * Einstellungen sichtbar und laesst sich dort jederzeit installieren -
     * beim naechsten Start noch einmal zu fragen waere Draengeln.
     */
    private void fragenWennNoetig() {
        if (frager == null || neueFassung.isEmpty()) return;
        if (neueFassung.equals(gefragtZu)) return;
        if (neueFassung.equals(einstellungen().getString(UEBERSPRUNGEN, ""))) return;
        gefragtZu = neueFassung;
        frager.fragen(neueFassung);
    }

    /** "Spaeter" - fuer diese Fassung wird nicht mehr von selbst gefragt. */
    public void ueberspringen() {
        if (neueFassung.isEmpty()) return;
        einstellungen().edit().putString(UEBERSPRUNGEN, neueFassung).apply();
    }

    // --- Installieren ---------------------------------------------------------

    /** Ob das Geraet ELFIX ueberhaupt installieren liesse. */
    public boolean darfInstallieren() {
        try {
            return context.getPackageManager().canRequestPackageInstalls();
        } catch (Exception fehler) {
            return false;
        }
    }

    /**
     * Die geladene APK dem Paketinstaller reichen.
     *
     * <p>Von hier an entscheidet das Betriebssystem: es zeigt seinen eigenen
     * Dialog, nennt die App beim Namen und installiert erst nach einem Ja.
     * ELFIX kann daran nichts vorbei, und das ist der Grund, warum das hier
     * ueberhaupt vertretbar ist.
     *
     * @return ob sich etwas oeffnen liess
     */
    public boolean installieren() {
        if (datei == null || !datei.isFile()) return false;
        if (!darfInstallieren()) {
            // Erst muss ELFIX das Recht bekommen, ueberhaupt zu fragen. Der
            // Weg dahin ist eine Systemseite - hinschicken ist ehrlicher, als
            // eine Fehlermeldung anzuzeigen, mit der niemand etwas anfangen
            // kann.
            try {
                Intent erlauben = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + context.getPackageName()));
                erlauben.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(erlauben);
            } catch (Exception ausnahme) {
                Log.w(TAG, "Seite fuer die Installationserlaubnis nicht erreichbar: " + ausnahme);
                return false;
            }
            return true;
        }
        try {
            Uri weg = androidx.core.content.FileProvider.getUriForFile(
                context, context.getPackageName() + ".dateien", datei);
            Intent installieren = new Intent(Intent.ACTION_VIEW);
            installieren.setDataAndType(weg, "application/vnd.android.package-archive");
            installieren.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(installieren);
            return true;
        } catch (Exception ausnahme) {
            Log.e(TAG, "Installation liess sich nicht anstossen", ausnahme);
            fertig(Lage.FEHLER, String.valueOf(ausnahme.getMessage()));
            return false;
        }
    }

    // --- Kleinkram -------------------------------------------------------------

    /**
     * Zwei Fassungen vergleichen.
     *
     * <p>Zahl fuer Zahl, nicht als Text: "1.10.0" ist neuer als "1.9.0", und
     * ein Textvergleich saehe das genau andersherum. Was keine Zahl ist, zaehlt
     * als null - ein Anhaengsel wie "-test" macht eine Fassung nicht neuer.
     *
     * @return groesser null, wenn {@code links} neuer ist
     */
    static int vergleichen(String links, String rechts) {
        String[] a = String.valueOf(links).split("[^0-9]+");
        String[] b = String.valueOf(rechts).split("[^0-9]+");
        for (int i = 0; i < Math.max(a.length, b.length); i += 1) {
            long eins = i < a.length ? zahl(a[i]) : 0;
            long zwei = i < b.length ? zahl(b[i]) : 0;
            if (eins != zwei) return eins > zwei ? 1 : -1;
        }
        return 0;
    }

    private static long zahl(String wert) {
        try {
            return wert == null || wert.isEmpty() ? 0 : Long.parseLong(wert);
        } catch (Exception fehler) {
            return 0;
        }
    }

    /** Die APK unter den Anhaengen des Releases. Windows-Dateien haengen dort ebenso. */
    private static String apkAdresse(JSONArray anhaenge) {
        JSONObject apk = apkFinden(anhaenge);
        return apk == null ? "" : apk.optString("browser_download_url", "");
    }

    private static long apkUmfang(JSONArray anhaenge) {
        JSONObject apk = apkFinden(anhaenge);
        return apk == null ? 0 : apk.optLong("size", 0);
    }

    private static JSONObject apkFinden(JSONArray anhaenge) {
        if (anhaenge == null) return null;
        for (int i = 0; i < anhaenge.length(); i += 1) {
            JSONObject anhang = anhaenge.optJSONObject(i);
            if (anhang == null) continue;
            if (anhang.optString("name", "").toLowerCase().endsWith(".apk")) return anhang;
        }
        return null;
    }

    private String holen(String von, String annehmen) throws Exception {
        HttpURLConnection verbindung = null;
        try {
            verbindung = verbinden(von, annehmen);
            try (InputStream strom = verbindung.getInputStream()) {
                java.io.ByteArrayOutputStream puffer = new java.io.ByteArrayOutputStream();
                byte[] block = new byte[8192];
                int gelesen;
                while ((gelesen = strom.read(block)) > 0) puffer.write(block, 0, gelesen);
                return puffer.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            if (verbindung != null) verbindung.disconnect();
        }
    }

    private HttpURLConnection verbinden(String von, String annehmen) throws Exception {
        HttpURLConnection verbindung = (HttpURLConnection) new URL(von).openConnection();
        verbindung.setConnectTimeout(NETZ_TIMEOUT_MS);
        verbindung.setReadTimeout(NETZ_TIMEOUT_MS);
        verbindung.setInstanceFollowRedirects(true);
        verbindung.setRequestProperty("Accept", annehmen);
        verbindung.setRequestProperty("User-Agent", "ELFIX-Android");
        int status = verbindung.getResponseCode();
        if (status >= 400) {
            verbindung.disconnect();
            throw new Exception("GitHub antwortete mit " + status);
        }
        return verbindung;
    }

    private File ordner() {
        File ziel = new File(context.getCacheDir(), ORDNER);
        if (!ziel.isDirectory() && !ziel.mkdirs()) Log.w(TAG, "Ordner fuer Fassungen fehlt");
        return ziel;
    }

    /** Was von frueheren Malen liegengeblieben ist. Eine APK ist kein kleines Ding. */
    private void aeltereWegraeumen(File behalten) {
        File[] alles = ordner().listFiles();
        if (alles == null) return;
        for (File eintrag : alles) {
            if (eintrag.equals(behalten)) continue;
            if (!eintrag.delete()) Log.w(TAG, "Alte Fassung blieb liegen: " + eintrag.getName());
        }
    }

    private long zuletztGesehen() {
        return einstellungen().getLong(ZULETZT_GESEHEN, 0);
    }

    private SharedPreferences einstellungen() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void fertig(Lage neu, String grund) {
        laeuft = false;
        fehler = grund == null ? "" : grund;
        melde(neu);
    }

    private void melde(Lage neu) {
        lage = neu;
        if (horcher != null) horcher.fassungGeaendert();
    }
}
