package local.elflix.android;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Die Titelbilder der Karten - holen, merken, anzeigen.
 *
 * <p>Am Rechner traegt jede Karte das Bild des Titels; auf dem Telefon standen
 * dort zwei Buchstaben. Nicht, weil das Bild fehlte - es steht laengst im
 * Eintrag und kommt sogar ueber den Geraeteabgleich mit -, sondern weil es
 * niemand geholt hat. Genau das tut diese Klasse, und mehr nicht.
 *
 * <p>Zwei Speicher, aus zwei Gruenden. Der im Arbeitsspeicher haelt, was gerade
 * auf dem Schirm ist: eine Liste wird beim Blaettern staendig neu gezeichnet,
 * und ohne ihn flackerte jede Karte. Der auf der Platte haelt es ueber den
 * Neustart hinaus - ein Titelbild aendert sich nicht, und ein Telefon im
 * Mobilfunk soll es kein zweites Mal laden muessen.
 *
 * <p>Verkleinert wird schon beim Dekodieren. Ein Poster kommt mit 600 mal 900
 * Pixeln herein und liegt auf einer Karte von 66 dp - ungerechnet waeren das
 * zwei Megabyte je Karte, und zwanzig Karten haetten die App aus dem Speicher
 * getragen.
 *
 * <p>Alles hier ist statisch und ohne Zustand ausser den Speichern: eine Karte
 * entsteht in {@link MobileViews} und {@link TvViews}, und die kennen keine
 * Activity.
 */
public final class Bilder {
    private static final String TAG = CrashReporter.TAG;
    private static final String ORDNER = "titelbilder";
    /** Wie viel Platz die Bilder auf der Platte hoechstens belegen. */
    private static final long PLATZ_BYTES = 40L * 1024 * 1024;
    private static final int TIMEOUT_MS = 12_000;
    private static final String AGENT =
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

    private static final ExecutorService netz = Executors.newFixedThreadPool(3);
    private static final Handler haupt = new Handler(Looper.getMainLooper());

    private static LruCache<String, Bitmap> speicher;
    private static boolean aufgeraeumt;

    private Bilder() {
    }

    /**
     * Das Bild an eine Karte haengen.
     *
     * <p>Der Aufruf kehrt sofort zurueck; geholt wird nebenher. Bis dahin
     * bleibt stehen, was die Karte ohnehin zeigt - der gestaltete Platzhalter
     * mit den Anfangsbuchstaben. Kommt nie ein Bild (kein Netz, kaputte
     * Adresse, Anbieter blockt), bleibt er einfach stehen; ein Loch entsteht
     * nicht.
     *
     * @param ziel     wohin das Bild gehoert
     * @param adresse  die Bildadresse aus dem Eintrag, leer erlaubt
     * @param breiteDp Kartenmass, damit nicht groesser dekodiert wird als noetig
     * @param beiBild  laeuft im Hauptthread, sobald wirklich ein Bild da ist
     */
    static void laden(ImageView ziel, String adresse, int breiteDp, int hoeheDp, Runnable beiBild) {
        if (ziel == null) return;
        String sauber = adresse == null ? "" : adresse.trim();
        // Der Merker haengt am Ziel, nicht am Auftrag: Listen benutzen ihre
        // Ansichten wieder, und die Antwort auf den vorigen Auftrag darf nicht
        // im Bild des naechsten landen.
        ziel.setTag(sauber);
        ziel.setImageDrawable(null);
        ziel.setVisibility(ImageView.GONE);
        if (sauber.isEmpty()) return;

        Context context = ziel.getContext().getApplicationContext();
        float dichte = context.getResources().getDisplayMetrics().density;
        int breite = Math.max(1, Math.round(breiteDp * dichte));
        int hoehe = Math.max(1, Math.round(hoeheDp * dichte));
        String schluessel = sauber + "@" + breite + "x" + hoehe;

        Bitmap bekannt = speicher(context).get(schluessel);
        if (bekannt != null) {
            zeigen(ziel, sauber, bekannt, beiBild);
            return;
        }
        netz.execute(() -> {
            Bitmap bild = holen(context, sauber, breite, hoehe);
            if (bild == null) return;
            speicher(context).put(schluessel, bild);
            haupt.post(() -> zeigen(ziel, sauber, bild, beiBild));
        });
    }

    private static void zeigen(ImageView ziel, String adresse, Bitmap bild, Runnable beiBild) {
        if (!adresse.equals(ziel.getTag())) return;
        ziel.setImageBitmap(bild);
        ziel.setVisibility(ImageView.VISIBLE);
        if (beiBild != null) beiBild.run();
    }

    private static synchronized LruCache<String, Bitmap> speicher(Context context) {
        if (speicher == null) {
            // Ein Achtel des Heaps ist die uebliche Aufteilung: genug fuer die
            // sichtbare Liste und weit weg von der Grenze, an der Android die
            // App abraeumt.
            int platz = (int) (Runtime.getRuntime().maxMemory() / 1024 / 8);
            speicher = new LruCache<String, Bitmap>(Math.max(2048, platz)) {
                @Override
                protected int sizeOf(String schluessel, Bitmap wert) {
                    return wert.getByteCount() / 1024;
                }
            };
        }
        if (!aufgeraeumt) {
            aufgeraeumt = true;
            Context anwendung = context.getApplicationContext();
            netz.execute(() -> aufraeumen(anwendung));
        }
        return speicher;
    }

    /* --------------------------------------------------------------- Holen */

    private static Bitmap holen(Context context, String adresse, int breite, int hoehe) {
        try {
            if (adresse.startsWith("data:")) return ausDatenAdresse(adresse, breite, hoehe);
            if (!adresse.startsWith("http")) return null;

            File datei = ablage(context, adresse);
            if (datei.isFile() && datei.length() > 0) {
                Bitmap ausAblage = dekodieren(datei, breite, hoehe);
                if (ausAblage != null) return ausAblage;
                // Eine unlesbare Datei ist schlimmer als keine: sie stuende
                // jedem weiteren Versuch im Weg.
                if (!datei.delete()) Log.d(TAG, "Titelbild nicht loeschbar: " + datei.getName());
            }
            byte[] roh = herunterladen(adresse);
            if (roh == null || roh.length == 0) return null;
            schreiben(datei, roh);
            Bitmap frisch = dekodieren(datei, breite, hoehe);
            if (frisch != null) return frisch;
            return BitmapFactory.decodeByteArray(roh, 0, roh.length);
        } catch (Exception fehler) {
            Log.d(TAG, "Titelbild nicht geladen: " + fehler);
            return null;
        } catch (OutOfMemoryError knapp) {
            Log.w(TAG, "Titelbild zu gross fuer den Speicher", knapp);
            return null;
        }
    }

    private static byte[] herunterladen(String adresse) throws Exception {
        HttpURLConnection verbindung = null;
        try {
            verbindung = (HttpURLConnection) new URL(adresse).openConnection();
            verbindung.setConnectTimeout(TIMEOUT_MS);
            verbindung.setReadTimeout(TIMEOUT_MS);
            verbindung.setInstanceFollowRedirects(true);
            verbindung.setRequestProperty("Accept", "image/avif,image/webp,image/*,*/*;q=0.8");
            verbindung.setRequestProperty("User-Agent", AGENT);
            // Manche Anbieter geben ihre Bilder nur an ihre eigene Seite
            // heraus. Der Verweis auf den eigenen Wirt ist das, was ein
            // Browser ohnehin schickte, wenn die Karte dort stuende.
            String herkunft = herkunftVon(adresse);
            if (!herkunft.isEmpty()) verbindung.setRequestProperty("Referer", herkunft);
            int status = verbindung.getResponseCode();
            if (status < 200 || status >= 300) return null;
            try (InputStream strom = verbindung.getInputStream()) {
                ByteArrayOutputStream puffer = new ByteArrayOutputStream(32 * 1024);
                byte[] block = new byte[16 * 1024];
                int gelesen;
                int gesamt = 0;
                while ((gelesen = strom.read(block)) > 0) {
                    gesamt += gelesen;
                    // Ein Titelbild ist keine zehn Megabyte gross. Was
                    // groesser ist, ist kein Titelbild.
                    if (gesamt > 10 * 1024 * 1024) return null;
                    puffer.write(block, 0, gelesen);
                }
                return puffer.toByteArray();
            }
        } finally {
            if (verbindung != null) verbindung.disconnect();
        }
    }

    private static String herkunftVon(String adresse) {
        try {
            URL url = new URL(adresse);
            return url.getProtocol() + "://" + url.getHost() + "/";
        } catch (Exception fehler) {
            return "";
        }
    }

    private static Bitmap ausDatenAdresse(String adresse, int breite, int hoehe) {
        int komma = adresse.indexOf(',');
        if (komma < 0 || !adresse.substring(0, komma).contains("base64")) return null;
        byte[] roh = Base64.decode(adresse.substring(komma + 1), Base64.DEFAULT);
        if (roh.length == 0) return null;
        BitmapFactory.Options masse = new BitmapFactory.Options();
        masse.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(roh, 0, roh.length, masse);
        BitmapFactory.Options einstellung = new BitmapFactory.Options();
        einstellung.inSampleSize = schrittweite(masse, breite, hoehe);
        return BitmapFactory.decodeByteArray(roh, 0, roh.length, einstellung);
    }

    private static Bitmap dekodieren(File datei, int breite, int hoehe) {
        BitmapFactory.Options masse = new BitmapFactory.Options();
        masse.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(datei.getAbsolutePath(), masse);
        if (masse.outWidth <= 0 || masse.outHeight <= 0) return null;
        BitmapFactory.Options einstellung = new BitmapFactory.Options();
        einstellung.inSampleSize = schrittweite(masse, breite, hoehe);
        return BitmapFactory.decodeFile(datei.getAbsolutePath(), einstellung);
    }

    /**
     * Um welche Zweierpotenz beim Dekodieren verkleinert wird.
     *
     * <p>Halbiert wird, solange beide Seiten noch groesser bleiben als die
     * Karte - so bleibt das Bild scharf und kostet trotzdem nur einen Bruchteil.
     */
    private static int schrittweite(BitmapFactory.Options masse, int breite, int hoehe) {
        int schritt = 1;
        while (masse.outWidth / (schritt * 2) >= breite && masse.outHeight / (schritt * 2) >= hoehe) {
            schritt *= 2;
        }
        return schritt;
    }

    /* -------------------------------------------------------------- Ablage */

    private static File ablage(Context context, String adresse) {
        File ordner = new File(context.getCacheDir(), ORDNER);
        if (!ordner.isDirectory() && !ordner.mkdirs()) {
            Log.d(TAG, "Bildablage nicht angelegt");
        }
        return new File(ordner, name(adresse));
    }

    private static String name(String adresse) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-1");
            byte[] abdruck = sha.digest(adresse.getBytes("UTF-8"));
            StringBuilder text = new StringBuilder(abdruck.length * 2);
            for (byte wert : abdruck) text.append(String.format("%02x", wert));
            return text.toString();
        } catch (Exception fehler) {
            return Integer.toHexString(adresse.hashCode());
        }
    }

    private static void schreiben(File ziel, byte[] roh) {
        // Erst daneben, dann umbenennen - wie bei der Favoritenablage: ein
        // abgebrochener Schreibvorgang hinterlaesst sonst eine halbe Datei,
        // die von da an als "schon geholt" gilt.
        File zwischen = new File(ziel.getAbsolutePath() + ".neu");
        try (FileOutputStream aus = new FileOutputStream(zwischen)) {
            aus.write(roh);
            aus.flush();
        } catch (Exception fehler) {
            Log.d(TAG, "Titelbild nicht abgelegt: " + fehler);
            return;
        }
        if (!zwischen.renameTo(ziel) && !zwischen.delete()) {
            Log.d(TAG, "Zwischendatei blieb liegen: " + zwischen.getName());
        }
    }

    /**
     * Platz schaffen, wenn die Ablage zu gross wird.
     *
     * <p>Weg kommt das Aelteste zuerst. Ein Bild, das noch gebraucht wird,
     * wird beim naechsten Zeichnen einfach wieder geholt - hier geht nichts
     * verloren, was nicht wiederzubeschaffen waere.
     */
    private static void aufraeumen(Context context) {
        File ordner = new File(context.getCacheDir(), ORDNER);
        File[] dateien = ordner.listFiles();
        if (dateien == null || dateien.length == 0) return;
        long gesamt = 0;
        for (File datei : dateien) gesamt += datei.length();
        if (gesamt <= PLATZ_BYTES) return;

        Arrays.sort(dateien, (links, rechts) -> Long.compare(links.lastModified(), rechts.lastModified()));
        for (File datei : dateien) {
            if (gesamt <= PLATZ_BYTES) break;
            long groesse = datei.length();
            if (datei.delete()) gesamt -= groesse;
        }
    }
}
