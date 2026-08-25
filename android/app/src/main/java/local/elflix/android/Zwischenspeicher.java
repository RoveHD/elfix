package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Etwas Geholtes, das einen Neustart ueberlebt.
 *
 * <p>Es geht um genau einen Fall, und der ist auf einem Telefon der Regelfall
 * und nicht die Ausnahme: <em>die App startet ohne Netz.</em> Bis hierher
 * standen dann die Vorschlagsreihen und der Kalender als Fehlermeldung da,
 * obwohl beim letzten Start alles vorlag - die Reihen lagen nur im
 * Arbeitsspeicher, und den raeumt Android beim Beenden ab.
 *
 * <p>Getrennt vom Zwischenspeicher des Kerns ({@code Kern.ZWISCHEN_ORDNER}):
 * der haelt Rohdaten fuer die Rechnung, dieser hier haelt <em>Ergebnisse</em>
 * fuer die Anzeige. Beides zu vermischen hiesse, beim Aufraeumen des einen das
 * andere zu verlieren.
 *
 * <p>Was hier liegt, ist ausdruecklich wegwerfbar. Es wird nie zur Quelle: was
 * frisch hereinkommt, gewinnt immer, und ein unlesbarer Inhalt gilt als nicht
 * vorhanden.
 */
public final class Zwischenspeicher {
    private static final String TAG = CrashReporter.TAG;
    private static final String ORDNER = "anzeige-zwischen";

    private Zwischenspeicher() {
    }

    private static File datei(Context context, String name) {
        File ordner = new File(context.getFilesDir(), ORDNER);
        if (!ordner.isDirectory() && !ordner.mkdirs()) return null;
        // Nur was hier als Name vergeben wird, nicht was von aussen kommt: der
        // Name landet in einem Pfad.
        return new File(ordner, name.replaceAll("[^a-z0-9_-]", "") + ".json");
    }

    /**
     * Ablegen - mit dem Zeitpunkt, damit die Anzeige sagen kann, wie alt es ist.
     *
     * <p>Erst daneben, dann umbenennen. Ein Abbruch mitten im Schreiben laesst
     * sonst eine halbe Datei zurueck, und die waere beim naechsten Start genau
     * das, was hier vermieden werden soll: nichts.
     */
    public static void ablegen(Context context, String name, String inhaltJson) {
        File ziel = datei(context, name);
        if (ziel == null || inhaltJson == null) return;
        File zwischen = new File(ziel.getAbsolutePath() + ".neu");
        try {
            JSONObject huelle = new JSONObject();
            huelle.put("at", System.currentTimeMillis());
            huelle.put("inhalt", inhaltJson);
            try (FileOutputStream strom = new FileOutputStream(zwischen)) {
                strom.write(huelle.toString().getBytes(StandardCharsets.UTF_8));
                strom.getFD().sync();
            }
            if (!zwischen.renameTo(ziel) && !(ziel.delete() && zwischen.renameTo(ziel))) {
                Log.e(TAG, "Zwischenspeicher " + name + " nicht ersetzt");
            }
        } catch (Exception fehler) {
            Log.e(TAG, "Zwischenspeicher " + name + " nicht abgelegt", fehler);
        } finally {
            if (zwischen.exists()) zwischen.delete();
        }
    }

    /** Was abgelegt wurde, oder {@code null}. Nie eine Ausnahme - fehlend ist normal. */
    public static Eintrag lesen(Context context, String name) {
        File quelle = datei(context, name);
        if (quelle == null || !quelle.isFile()) return null;
        try (InputStream strom = new FileInputStream(quelle)) {
            byte[] roh = new byte[(int) quelle.length()];
            int gelesen = 0;
            while (gelesen < roh.length) {
                int schritt = strom.read(roh, gelesen, roh.length - gelesen);
                if (schritt < 0) break;
                gelesen += schritt;
            }
            JSONObject huelle = new JSONObject(new String(roh, 0, gelesen, StandardCharsets.UTF_8));
            String inhalt = huelle.optString("inhalt", "");
            if (inhalt.isEmpty()) return null;
            return new Eintrag(inhalt, huelle.optLong("at", 0));
        } catch (Exception fehler) {
            Log.e(TAG, "Zwischenspeicher " + name + " unlesbar", fehler);
            return null;
        }
    }

    public static void loeschen(Context context, String name) {
        File quelle = datei(context, name);
        if (quelle != null && quelle.isFile() && !quelle.delete()) {
            Log.e(TAG, "Zwischenspeicher " + name + " nicht geloescht");
        }
    }

    /** Alles wegwerfen - beim "Alles neu laden" der Einstellungen. */
    public static void alleLoeschen(Context context) {
        File ordner = new File(context.getFilesDir(), ORDNER);
        File[] inhalt = ordner.listFiles();
        if (inhalt == null) return;
        for (File datei : inhalt) {
            if (!datei.delete()) Log.e(TAG, "Zwischenspeicher nicht geloescht: " + datei.getName());
        }
    }

    /** Ein abgelegter Stand samt seinem Alter. */
    public static final class Eintrag {
        public final String inhalt;
        public final long stand;

        Eintrag(String inhalt, long stand) {
            this.inhalt = inhalt;
            this.stand = stand;
        }

        /** Wie alt, in Worten - "vor 2 Stunden". Fuer den Hinweis ueber alten Daten. */
        public String alter() {
            long spanne = System.currentTimeMillis() - stand;
            if (stand <= 0 || spanne < 0) return "";
            long minuten = spanne / 60000L;
            if (minuten < 2) return "gerade eben";
            if (minuten < 60) return "vor " + minuten + " Minuten";
            long stunden = minuten / 60;
            if (stunden < 24) return "vor " + stunden + (stunden == 1 ? " Stunde" : " Stunden");
            long tage = stunden / 24;
            return "vor " + tage + (tage == 1 ? " Tag" : " Tagen");
        }
    }
}
