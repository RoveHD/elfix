package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Sicherungen auf Android.
 *
 * <h2>Wozu</h2>
 *
 * <p>Ein Update laesst den Bestand in aller Regel stehen - die APK wird
 * darueber installiert, nicht neu. In aller Regel ist aber nicht immer, und
 * der eine Fall, in dem es schiefgeht, ist genau der, in dem niemand eine
 * Sicherung hat. Deshalb legt ELFIX vor jeder Installation selbst eine an.
 *
 * <p>Sie kostet einen Augenblick und ein paar hundert Kilobyte. Sie zu haben
 * und nicht zu brauchen ist der bessere Handel.
 *
 * <h2>Was hineingehoert</h2>
 *
 * <p>Entschieden wird das in {@code sicherung.js} - demselben Modul, mit dem
 * der Rechner seine Sicherungen baut und liest. Eine hier gebaute Sicherung
 * laesst sich damit am Rechner einlesen und umgekehrt; zwei Formate waeren
 * zwei Wahrheiten.
 *
 * <h2>Wo sie liegt</h2>
 *
 * <p>Im eigenen Datenordner der App, Unterordner {@code sicherungen}. Nicht im
 * gemeinsamen Speicher: dort braeuchte es eine Berechtigung, und eine
 * Berechtigungsfrage vor einem Update ist genau die Huerde, an der eine
 * Sicherheitskopie scheitert. Ein Update ueberlebt diesen Ordner - eine
 * Deinstallation nicht, und das ist der Preis.
 */
public final class Sicherung {
    private static final String TAG = CrashReporter.TAG;
    private static final String ORDNER = "sicherungen";

    private final Context context;
    private final Kern kern;
    private final Bestand bestand;
    private final Statistik statistik;
    private final Watchparty watchparty;

    public Sicherung(Context context, Kern kern, Bestand bestand, Statistik statistik,
                     Watchparty watchparty) {
        this.context = context.getApplicationContext();
        this.kern = kern;
        this.bestand = bestand;
        this.statistik = statistik;
        this.watchparty = watchparty;
    }

    /** Die Fassung dieser App - fuer die Datei, damit man ihr ansieht, woher sie kommt. */
    private String programmFassung() {
        try {
            return context.getPackageManager()
                .getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (Exception fehler) {
            return "";
        }
    }

    /** Wird gerufen, wenn die Sicherung steht - oder feststeht, dass keine kommt. */
    public interface Fertig {
        void sicherungFertig(String pfad);
    }

    /**
     * Eine Sicherung anlegen.
     *
     * <p>Ohne Nachfrage und ohne Abbruch: schlaegt sie fehl, geht es trotzdem
     * weiter. Eine Sicherung soll ein Update begleiten, nicht verhindern.
     *
     * @param anlass warum es sie gibt - steht im Dateinamen und in der Datei
     */
    public void anlegen(String anlass, Fertig fertig) {
        if (kern == null || !kern.istBereit()) {
            Log.d(TAG, "Sicherung: der Kern steht nicht - keine angelegt");
            if (fertig != null) fertig.sicherungFertig("");
            return;
        }
        JSONObject quellen = new JSONObject();
        try {
            quellen.put("settings", einstellungen());
            quellen.put("favorites", bestand == null ? new JSONArray() : bestand.roh());
            JSONArray anbieterListe = new JSONArray();
            for (Provider eintrag : ProviderStore.ladeAlle(context)) anbieterListe.put(eintrag.alsJson());
            quellen.put("providers", anbieterListe);
            quellen.put("watchparty", watchparty == null ? null : watchparty.kontoSatz());
            // Die Sitzungen sind gemessene Zeit und kommen nie wieder.
            quellen.put("sitzungen", statistik == null ? new JSONArray() : statistik.alle());
            // Fassungen und Marken liegen in ihren eigenen Ablagen. Von dort
            // gelesen und nicht ueber ihre Klassen: die halten ihren Stand im
            // Kern, und dort ihn abzufragen waere ein zweiter Weg zu denselben
            // Daten - mit der Gefahr, dass er ein anderes Ergebnis liefert.
            quellen.put("fassungen", new Ablage(context, "fassungen.json", 1).lesen());
            quellen.put("marken", new Ablage(context, "marken.json", 1).lesen());
            quellen.put("programm", programmFassung());
            quellen.put("anlass", anlass == null ? "auto" : anlass);
        } catch (Exception fehler) {
            Log.e(TAG, "Sicherung liess sich nicht vorbereiten", fehler);
            if (fertig != null) fertig.sicherungFertig("");
            return;
        }
        kern.rufe("sicherung.bauen", Kern.args(quellen), (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.e(TAG, "Sicherung nicht gebaut: " + fehler);
                if (fertig != null) fertig.sicherungFertig("");
                return;
            }
            String pfad = schreiben(anlass, wert);
            if (fertig != null) fertig.sicherungFertig(pfad);
        });
    }

    /**
     * Die Einstellungen dieses Geraets, so wie sie in eine Sicherung gehoeren.
     *
     * <p>Die Watchparty gehoert dazu - Raeume und Adresse -, die Geraetekennung
     * ausdruecklich nicht. Sie gehoert dem Geraet: zwei Geraete mit derselben
     * Kennung gelten im Raum als eines.
     */
    private JSONObject einstellungen() {
        JSONObject alles = new JSONObject();
        try {
            JSONObject wp = new JSONObject();
            if (watchparty != null) {
                wp.put("enabled", watchparty.istEingeschaltet());
                wp.put("serverUrl", watchparty.serverUrl());
                wp.put("deviceName", watchparty.geraetName());
                JSONArray codes = new JSONArray();
                for (String code : watchparty.raumcodes()) codes.put(code);
                wp.put("rooms", codes);
            }
            alles.put("watchparty", wp);
            // Die uebrigen Einstellungen der App - Startseite, Werbeblocker,
            // Autoplay, Geraeteabgleich. Sie liegen in SharedPreferences und
            // gehen als Ganzes mit; welcher Schluessel was bedeutet, weiss die
            // App beim Einlesen selbst.
            JSONObject android = new JSONObject();
            for (java.util.Map.Entry<String, ?> eintrag
                : context.getSharedPreferences("elflix_settings", Context.MODE_PRIVATE)
                    .getAll().entrySet()) {
                android.put(eintrag.getKey(), eintrag.getValue());
            }
            alles.put("android", android);
        } catch (Exception fehler) {
            Log.e(TAG, "Einstellungen nicht gesammelt", fehler);
        }
        return alles;
    }

    /** Die fertige Sicherung ablegen und alte wegraeumen. */
    private String schreiben(String anlass, String inhalt) {
        try {
            File ordner = new File(context.getFilesDir(), ORDNER);
            if (!ordner.isDirectory() && !ordner.mkdirs()) {
                Log.w(TAG, "Sicherungsordner nicht angelegt");
                return "";
            }
            String text = inhalt;
            // Der Kern gibt JSON-Text zurueck; er ist schon fertig.
            File ziel = new File(ordner, namen(anlass));
            java.io.FileOutputStream aus = new java.io.FileOutputStream(ziel);
            try {
                aus.write(text.getBytes("UTF-8"));
                aus.flush();
            } finally {
                aus.close();
            }
            Log.i(TAG, "Sicherung angelegt: " + ziel.getName() + " (" + ziel.length() + " Bytes)");
            aufraeumen(ordner);
            return ziel.getAbsolutePath();
        } catch (Exception fehler) {
            // Kein Abbruch. Siehe oben.
            Log.e(TAG, "Sicherung nicht geschrieben", fehler);
            return "";
        }
    }

    /**
     * Der Name - mit Uhrzeit, nicht nur mit Datum.
     *
     * <p>Vor einem Update kann zweimal am selben Tag eine entstehen, und die
     * zweite darf die erste nicht ueberschreiben: sonst waere die
     * Rueckfahrkarte weg, sobald man sie zweimal braucht. Dieselbe Form wie am
     * Rechner ({@code selbstName} in sicherung.js).
     */
    private static String namen(String anlass) {
        java.util.Calendar jetzt = java.util.Calendar.getInstance();
        String stempel = String.format(java.util.Locale.ROOT, "%04d%02d%02d-%02d%02d%02d",
            jetzt.get(java.util.Calendar.YEAR), jetzt.get(java.util.Calendar.MONTH) + 1,
            jetzt.get(java.util.Calendar.DAY_OF_MONTH), jetzt.get(java.util.Calendar.HOUR_OF_DAY),
            jetzt.get(java.util.Calendar.MINUTE), jetzt.get(java.util.Calendar.SECOND));
        String sauber = (anlass == null ? "auto" : anlass).replaceAll("[^a-zA-Z0-9-]", "").toLowerCase();
        if (sauber.isEmpty()) sauber = "auto";
        return "ELFIX-" + sauber + "-" + stempel + ".elfix.json";
    }

    /**
     * Alte Sicherungen wegraeumen.
     *
     * <p>Sie sammeln sich sonst: vor jedem Update eine, und ELFIX bekommt
     * mehrere Fassungen in der Woche. Behalten wird die juengste Handvoll -
     * genug fuer ein misslungenes Update, wenig genug, dass der Datenordner
     * nicht zulaeuft. Sortiert wird nach dem Namen; der Zeitstempel darin ist
     * so gebaut, dass alphabetisch und chronologisch dasselbe ist.
     */
    private static void aufraeumen(File ordner) {
        String[] namen = ordner.list();
        if (namen == null || namen.length <= BEHALTEN) return;
        List<String> eigene = new ArrayList<>();
        for (String name : namen) {
            if (name != null && name.startsWith("ELFIX-") && name.endsWith(".elfix.json")) {
                eigene.add(name);
            }
        }
        if (eigene.size() <= BEHALTEN) return;
        String[] sortiert = eigene.toArray(new String[0]);
        Arrays.sort(sortiert);
        for (int i = 0; i < sortiert.length - BEHALTEN; i += 1) {
            File weg = new File(ordner, sortiert[i]);
            if (!weg.delete()) Log.d(TAG, "Alte Sicherung blieb liegen: " + sortiert[i]);
        }
    }

    /** Wie viele selbst angelegte Sicherungen stehenbleiben. */
    private static final int BEHALTEN = 5;

    /** Die vorhandenen Sicherungen - fuer die Anzeige in den Einstellungen. */
    public List<File> vorhandene() {
        List<File> liste = new ArrayList<>();
        File ordner = new File(context.getFilesDir(), ORDNER);
        File[] dateien = ordner.listFiles();
        if (dateien == null) return liste;
        Arrays.sort(dateien, (links, rechts) -> rechts.getName().compareTo(links.getName()));
        for (File datei : dateien) {
            if (datei.isFile() && datei.getName().endsWith(".elfix.json")) liste.add(datei);
        }
        return liste;
    }
}
