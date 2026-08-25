package local.elflix.android;

import android.util.Log;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Ist das ein YouTube-Eintrag?
 *
 * <p>Eine kleine Frage mit einem Grund, sie eigens zu stellen: auf der
 * Startseite bekommt YouTube eine eigene Reihe. Ein angefangenes Video und eine
 * angefangene Serie sind zwei verschiedene Dinge - bei der Serie geht es darum,
 * sie zu Ende zu bringen, bei YouTube schaut man nebenbei. Gemischt schiebt das
 * eine das andere aus der Reihe, und weil YouTube-Videos oft kommen und gehen,
 * waeren es meist die Serien, die verdraengt werden. Genau so steht es am
 * Rechner, und genau das fehlte hier.
 *
 * <p>Die Namensliste kommt aus {@code youtube.js} im Kern und nicht aus dieser
 * Datei. Das ist der Teil, der sich aendert - ein vierter Name, den nur eine
 * Seite kennt, ist genau die Art Unterschied, an dem die 37 doppelten
 * Funktionen von damals gestorben sind. Der Abgleich selbst sind drei Zeilen
 * und laeuft hier, weil ein Aufruf in den Kern je Eintrag und je Zeichenlauf
 * teurer waere als die Frage wert ist.
 */
public final class Youtube {
    private static final String TAG = CrashReporter.TAG;

    /**
     * Der Rueckfall, bis der Kern geantwortet hat.
     *
     * <p>Er steht hier nicht als zweite Wahrheit, sondern als Startwert: die
     * Startseite baut sich auf, bevor der Kern oben ist, und ohne Liste stuende
     * in dem Augenblick jedes YouTube-Video in der Serienreihe. Weicht er
     * spaeter von der Liste des Kerns ab, gewinnt der Kern.
     */
    private static final List<String> RUECKFALL =
        Arrays.asList("youtube.com", "youtu.be", "youtube-nocookie.com");

    private final Kern kern;
    private List<String> hosts = new ArrayList<>(RUECKFALL);

    public Youtube(Kern kern) {
        this.kern = kern;
    }

    /** Die Namensliste aus dem Kern holen. Einmal je Programmlauf - sie aendert sich nicht. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.rufe("youtube.YOUTUBE_HOSTS", (wert, fehler) -> {
            if (fehler != null || wert == null) {
                Log.w(TAG, "YouTube-Namensliste nicht geholt, Rueckfall gilt: " + fehler);
                return;
            }
            try {
                JSONArray liste = new JSONArray(wert);
                ArrayList<String> neu = new ArrayList<>(liste.length());
                for (int i = 0; i < liste.length(); i += 1) {
                    String name = liste.optString(i, "").trim().toLowerCase(Locale.ROOT);
                    if (!name.isEmpty()) neu.add(name);
                }
                if (!neu.isEmpty()) hosts = neu;
            } catch (Exception ausnahme) {
                Log.w(TAG, "YouTube-Namensliste unlesbar, Rueckfall gilt", ausnahme);
            }
        });
    }

    public boolean istYoutube(String url) {
        String host = hostVon(url);
        if (host.isEmpty()) return false;
        for (String name : hosts) {
            if (host.equals(name) || host.endsWith("." + name)) return true;
        }
        return false;
    }

    public boolean istYoutube(Favorite eintrag) {
        return eintrag != null && istYoutube(eintrag.url());
    }

    /**
     * Der Name des Wirts, so wie {@code youtube.js} ihn normalisiert.
     *
     * <p>{@code www.}, {@code m.} und {@code music.} fallen weg - dieselben
     * drei und in derselben Reihenfolge. ROOT und nicht die Sprache des
     * Geraets: in der Tuerkei wird aus einem "I" ein punktloses "i", und
     * "YouTube.com" waere dort kein YouTube mehr.
     */
    static String hostVon(String url) {
        String text = url == null ? "" : url.trim();
        if (text.isEmpty()) return "";
        try {
            String host = java.net.URI.create(text).getHost();
            if (host == null) return "";
            host = host.toLowerCase(Locale.ROOT);
            if (host.startsWith("www.")) host = host.substring(4);
            if (host.startsWith("m.")) host = host.substring(2);
            if (host.startsWith("music.")) host = host.substring(6);
            return host;
        } catch (Exception fehler) {
            return "";
        }
    }
}
