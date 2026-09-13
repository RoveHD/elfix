package local.elflix.android;

import org.json.JSONObject;

import java.util.function.Consumer;

/** Nicht-blockierende Android-Seite der gemeinsamen AnimeFillerList-Regel. */
final class AnimeFiller {
    private final Kern kern;

    AnimeFiller(Kern kern) {
        this.kern = kern;
    }

    /**
     * Gibt immer den urspruenglichen Stand zurueck, wenn der Kern oder die
     * freie Quelle nicht erreichbar ist. Die Folgenwahl wartet nie darauf.
     */
    void anreichern(JSONObject stand, String url, Consumer<JSONObject> fertig) {
        if (fertig == null) return;
        JSONObject original = stand == null ? new JSONObject() : stand;
        if (kern == null) { fertig.accept(original); return; }
        final JSONObject kontext = new JSONObject();
        try {
            kontext.put("url", url == null ? "" : url);
        } catch (Exception unlesbar) { fertig.accept(original); return; }
        kern.wennBereit(() -> kern.rufe("anime-filler-bruecke.anreichern",
            Kern.args(original, kontext),
            (wert, fehler) -> {
                if (fehler != null || wert == null) { fertig.accept(original); return; }
                try { fertig.accept(new JSONObject(wert)); }
                catch (Exception unlesbar) { fertig.accept(original); }
            }));
    }
}
