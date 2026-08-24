package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Die Ablage der Eintraege - dieselbe Datei und dasselbe Format wie am Desktop.
 *
 * <p>Vorher lagen die Favoriten in {@code SharedPreferences}, als Liste aus acht
 * Feldern. Das war nicht nur zu wenig fuer Fortschritt und Mediathek, es war
 * auch ein anderes Format als das des Rechners: ein Abgleich haette an jeder
 * Stelle uebersetzen muessen, und jede Uebersetzung ist eine Gelegenheit, etwas
 * zu verlieren. Jetzt steht hier {@code favorites.json} mit genau dem Inhalt,
 * den die Desktop-App schreibt.
 *
 * <p>Der alte Bestand geht nicht verloren: er wird einmalig uebernommen und die
 * alte Ablage danach geleert.
 */
public final class FavoriteStore {
    private static final String TAG = CrashReporter.TAG;
    private static final String DATEI = "favorites.json";
    private static final String ALT_PREFS = "elflix-favorites";
    private static final String ALT_KEY = "favorites";

    private FavoriteStore() {
    }

    public static List<Favorite> load(Context context) {
        JSONArray roh = ladeRoh(context);
        ArrayList<Favorite> eintraege = new ArrayList<>(roh.length());
        for (int i = 0; i < roh.length(); i += 1) {
            JSONObject eintrag = roh.optJSONObject(i);
            if (eintrag == null) continue;
            if (!eintrag.optString("url", "").startsWith("http")) continue;
            eintraege.add(new Favorite(eintrag));
        }
        return eintraege;
    }

    /** Die Liste, wie der Kern sie erwartet: rohe Objekte in der Reihenfolge der Ablage. */
    public static JSONArray ladeRoh(Context context) {
        File datei = new File(context.getFilesDir(), DATEI);
        if (!datei.isFile()) {
            JSONArray uebernommen = altenBestandUebernehmen(context);
            if (uebernommen.length() > 0) speichereRoh(context, uebernommen);
            return uebernommen;
        }
        try {
            return new JSONArray(dateiLesen(datei));
        } catch (Exception fehler) {
            Log.e(TAG, "favorites.json unlesbar - es wird nichts geloescht, nur nichts geladen", fehler);
            return new JSONArray();
        }
    }

    /**
     * Schreibt die Liste - vollstaendig.
     *
     * <p>Hier stand einmal eine Obergrenze von sechshundert Eintraegen, mit der
     * Begruendung, der Rechner habe dieselbe. Er hat sie nicht. Was das in
     * Wahrheit war: eine stille Loeschung. Wer mehr Titel mitbringt, verlor
     * beim Speichern den Rest - und weil der Abgleich aus eben dieser Datei
     * ableitet, was hier noch steht, ging der abgeschnittene Rest beim
     * naechsten Start als "hier geloescht" hinaus und war danach auf keinem
     * Geraet mehr da.
     *
     * <p>Eine Grenze, die Daten wegwirft, gehoert nicht in die Ablage. Wenn
     * lange Listen einmal zu langsam werden, ist das eine Frage der Anzeige -
     * und dort gehoert sie dann auch hin.
     */
    public static void speichereRoh(Context context, JSONArray eintraege) {
        File ziel = new File(context.getFilesDir(), DATEI);
        // Erst danebenschreiben, dann umbenennen: bricht der Vorgang ab, ist
        // die alte Datei noch da. Ein halb geschriebener Stand waere schlimmer
        // als ein alter.
        File zwischen = new File(context.getFilesDir(), DATEI + ".neu");
        try (FileOutputStream aus = new FileOutputStream(zwischen)) {
            aus.write(eintraege.toString().getBytes(StandardCharsets.UTF_8));
            aus.flush();
        } catch (Exception fehler) {
            Log.e(TAG, "favorites.json liess sich nicht schreiben", fehler);
            return;
        }
        if (!zwischen.renameTo(ziel)) {
            // renameTo scheitert auf manchen Geraeten, wenn das Ziel existiert.
            if (!ziel.delete() || !zwischen.renameTo(ziel)) {
                Log.e(TAG, "favorites.json liess sich nicht ersetzen");
            }
        }
    }

    public static void save(Context context, List<Favorite> eintraege) {
        JSONArray roh = new JSONArray();
        for (Favorite eintrag : eintraege) roh.put(eintrag.roh);
        speichereRoh(context, roh);
    }

    /**
     * Holt herueber, was in der alten Ablage steht.
     *
     * <p>Die alten Eintraege kennen keinen Fortschritt - den kann auch niemand
     * nachtraeglich erfinden. Sie kommen deshalb als das herein, was sie waren:
     * gemerkte Titel auf der Watchlist. Was davon wirklich laeuft, ergibt sich
     * beim naechsten Anschauen von selbst.
     */
    private static JSONArray altenBestandUebernehmen(Context context) {
        SharedPreferences alt = context.getSharedPreferences(ALT_PREFS, Context.MODE_PRIVATE);
        String gespeichert = alt.getString(ALT_KEY, "");
        JSONArray uebernommen = new JSONArray();
        if (gespeichert == null || gespeichert.isEmpty()) return uebernommen;
        try {
            JSONArray alteListe = new JSONArray(gespeichert);
            for (int i = 0; i < alteListe.length(); i += 1) {
                JSONObject alterEintrag = alteListe.optJSONObject(i);
                if (alterEintrag == null) continue;
                String url = alterEintrag.optString("url", "");
                if (!url.startsWith("http")) continue;
                JSONObject neu = new JSONObject();
                neu.put("id", alterEintrag.optString("id", UUID.randomUUID().toString()));
                neu.put("providerId", alterEintrag.optString("providerId", ""));
                neu.put("providerName", alterEintrag.optString("providerName", ""));
                neu.put("title", alterEintrag.optString("title", "Favorit"));
                neu.put("url", url);
                neu.put("normalizedUrl", normalizeUrl(url));
                neu.put("favicon", alterEintrag.optString("favicon", ""));
                neu.put("thumbnail", alterEintrag.optString("thumbnail", ""));
                neu.put("logo", "");
                neu.put("favorite", true);
                neu.put("watched", false);
                neu.put("completed", false);
                neu.put("episodeCompleted", false);
                neu.put("continuePending", false);
                neu.put("hideFromContinueWatching", false);
                neu.put("completedEpisodes", new JSONArray());
                neu.put("activity", new JSONArray());
                neu.put("progress", 0);
                neu.put("duration", 0);
                neu.put("position", 0);
                neu.put("currentTime", 0);
                neu.put("type", "");
                neu.put("season", 0);
                neu.put("episode", 0);
                neu.put("createdAt", alterEintrag.optString("createdAt", ""));
                neu.put("openedAt", "");
                neu.put("lastWatchedAt", "");
                uebernommen.put(neu);
            }
            Log.i(TAG, "Alte Favoritenablage uebernommen: " + uebernommen.length() + " Eintraege");
            alt.edit().remove(ALT_KEY).apply();
        } catch (Exception fehler) {
            Log.e(TAG, "Alte Favoritenablage liess sich nicht uebernehmen", fehler);
        }
        return uebernommen;
    }

    private static String dateiLesen(File datei) throws Exception {
        try (InputStream strom = new java.io.FileInputStream(datei)) {
            ByteArrayOutputStream puffer = new ByteArrayOutputStream((int) Math.max(1024, datei.length()));
            byte[] block = new byte[8192];
            int gelesen;
            while ((gelesen = strom.read(block)) > 0) puffer.write(block, 0, gelesen);
            return puffer.toString(StandardCharsets.UTF_8.name());
        }
    }

    /**
     * Nur fuer den Notfall: die eigentliche Normalisierung steht im geteilten
     * Modul und laeuft im Kern. Hier genuegt sie beim Uebernehmen alter Daten,
     * wo der Kern noch gar nicht laufen muss.
     */
    public static String normalizeUrl(String value) {
        if (value == null) return "";
        int hash = value.indexOf("#");
        String clean = hash >= 0 ? value.substring(0, hash) : value;
        while (clean.length() > 1 && clean.endsWith("/")) {
            clean = clean.substring(0, clean.length() - 1);
        }
        return clean;
    }
}
