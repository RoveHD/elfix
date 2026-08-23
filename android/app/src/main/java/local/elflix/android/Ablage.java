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
 * Eine Datei in der Form, die die Desktop-App schreibt: {@code {version, eintraege}}.
 *
 * <p>Nicht aus Ordnungsliebe. Was gelernt wird - Fassungen, Intromarken - soll
 * sich zwischen Telefon und Rechner abgleichen lassen, und ein Abgleich, der an
 * jeder Stelle uebersetzen muss, verliert bei jeder Uebersetzung etwas. Steht
 * hier dasselbe wie dort, ist der Abgleich ein Dateiaustausch und keine
 * Umrechnung.
 *
 * <p>Ein unlesbarer Inhalt loescht nichts. Er wird gemeldet und die Ablage
 * gilt als leer - die naechste Aenderung schreibt sie neu. Das ist besser als
 * eine Datei, die beim Lesen stirbt, aber schlechter als eine, die nie kaputt
 * geht; deshalb wird beim Schreiben zuerst daneben und dann umbenannt.
 */
public final class Ablage {
    private static final String TAG = CrashReporter.TAG;

    private final Context context;
    private final String datei;
    private final int schema;

    public Ablage(Context context, String datei, int schema) {
        this.context = context;
        this.datei = datei;
        this.schema = schema;
    }

    /** Die Eintraege, ohne den Rahmen aus Fassungsnummer und Feldnamen. */
    public JSONObject lesen() {
        File ziel = new File(context.getFilesDir(), datei);
        if (!ziel.isFile()) return new JSONObject();
        try (InputStream strom = new FileInputStream(ziel)) {
            byte[] roh = new byte[(int) ziel.length()];
            int gelesen = 0;
            while (gelesen < roh.length) {
                int schritt = strom.read(roh, gelesen, roh.length - gelesen);
                if (schritt < 0) break;
                gelesen += schritt;
            }
            JSONObject inhalt = new JSONObject(new String(roh, 0, gelesen, StandardCharsets.UTF_8));
            JSONObject eintraege = inhalt.optJSONObject("eintraege");
            return eintraege == null ? new JSONObject() : eintraege;
        } catch (Exception fehler) {
            Log.e(TAG, datei + " unlesbar - es wird nichts geloescht, nur nichts geladen", fehler);
            return new JSONObject();
        }
    }

    /**
     * Schreiben - erst daneben, dann umbenennen.
     *
     * <p>Ein Absturz mitten im Schreiben laesst sonst eine halbe Datei zurueck,
     * und die ist beim naechsten Start unlesbar. Das Umbenennen ist der eine
     * Schritt, den das Dateisystem nicht halb ausfuehrt.
     */
    public void schreiben(JSONObject eintraege) {
        File ziel = new File(context.getFilesDir(), datei);
        File zwischen = new File(context.getFilesDir(), datei + ".neu");
        try {
            JSONObject inhalt = new JSONObject();
            inhalt.put("version", schema);
            inhalt.put("eintraege", eintraege == null ? new JSONObject() : eintraege);
            try (FileOutputStream strom = new FileOutputStream(zwischen)) {
                strom.write(inhalt.toString(2).getBytes(StandardCharsets.UTF_8));
                strom.getFD().sync();
            }
            if (!zwischen.renameTo(ziel)) {
                // Manche Dateisysteme benennen nicht ueber eine vorhandene
                // Datei hinweg. Dann eben in zwei Schritten - das Fenster
                // dazwischen ist kurz, und die Zwischendatei bleibt heil.
                if (ziel.delete() && zwischen.renameTo(ziel)) return;
                Log.e(TAG, datei + " nicht ersetzt");
            }
        } catch (Exception fehler) {
            Log.e(TAG, datei + " nicht gespeichert", fehler);
        } finally {
            if (zwischen.exists()) zwischen.delete();
        }
    }
}
