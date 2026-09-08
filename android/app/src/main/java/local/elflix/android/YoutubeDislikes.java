package local.elflix.android;

import android.content.Context;
import android.webkit.WebView;

import org.json.JSONObject;
import java.util.WeakHashMap;

/**
 * Die geschätzte Dislike-Zahl von Return YouTube Dislike auf Telefon und TV.
 *
 * Die API und das DOM-Skript liegen im gemeinsamen JavaScript-Modul, damit
 * Desktop, Telefon und Fernseher dieselbe Kennzeichnung und dieselben
 * Fehlerregeln verwenden. Diese Klasse bewahrt allein den lokalen Schalter
 * und bringt das fertige Skript in den aktiven YouTube-Player-Rahmen.
 */
public final class YoutubeDislikes {
    private static final String PREFS = "elflix_settings";
    private static final String SCHALTER = "youtube_dislikes_enabled";

    private final Context context;
    private final Kern kern;
    private final Rahmen rahmen;
    private final WeakHashMap<WebView, Long> auftraege = new WeakHashMap<>();

    public YoutubeDislikes(Context context, Kern kern, Rahmen rahmen) {
        this.context = context;
        this.kern = kern;
        this.rahmen = rahmen;
    }

    public boolean eingeschaltet() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(SCHALTER, true);
    }

    public void einschalten(boolean an) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(SCHALTER, an).apply();
    }

    /** Holt nur eine Zahl und bringt niemals ein fremdes Skript auf Nicht-YouTube. */
    public void einspielen(WebView ansicht, String url) {
        if (ansicht == null || url == null || !url.startsWith("http")) return;
        if (kern == null || !kern.istBereit() || rahmen == null) return;
        final long auftrag = auftraege.getOrDefault(ansicht, 0L) + 1L;
        auftraege.put(ansicht, auftrag);
        if (!eingeschaltet()) {
            kern.rufe("youtube-dislikes-bruecke.abschalten", (wert, fehler) -> {
                if (fehler == null && !eingeschaltet() && Long.valueOf(auftrag).equals(auftraege.get(ansicht))) rahmen.anSpieler(ansicht, Kern.text(wert));
            });
            return;
        }
        JSONObject einstellungen = new JSONObject();
        try { einstellungen.put("enabled", true); } catch (Exception ignored) {}
        kern.rufe("youtube-dislikes-bruecke.skript", Kern.args(url, einstellungen), (wert, fehler) -> {
            if (fehler != null || !eingeschaltet() || !Long.valueOf(auftrag).equals(auftraege.get(ansicht))) return;
            String skript = Kern.text(wert);
            if (!skript.isEmpty()) rahmen.anSpieler(ansicht, skript);
        });
    }
}
