package local.elflix.android;

import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Read-only presentation rule for episode spoilers.
 *
 * <p>The favorite remains the source of truth. In particular, a current
 * season/episode or a synchronized playback position never makes an episode
 * visible; only {@code completedEpisodes} does.
 */
final class SpoilerSchutz {
    static final String PREF_KEY = "playback.spoilerProtection";

    static final class Einstellung {
        final boolean enabled;
        final boolean roomMinimum;
        final boolean shareWatchedWithRoom;

        Einstellung(boolean enabled, boolean roomMinimum, boolean shareWatchedWithRoom) {
            this.enabled = enabled;
            this.roomMinimum = roomMinimum;
            this.shareWatchedWithRoom = shareWatchedWithRoom;
        }
    }

    /** Ephemeral relay aggregate. It is never written into favorites. */
    static final class Raumstand {
        final boolean known;
        final JSONArray completed;

        Raumstand(boolean known, JSONArray completed) {
            this.known = known;
            this.completed = normalisiert(completed);
        }
    }

    static Einstellung laden(SharedPreferences prefs) {
        try {
            JSONObject wert = new JSONObject(prefs.getString(PREF_KEY,
                "{\"enabled\":false,\"roomMinimum\":false}"));
            return new Einstellung(wert.optBoolean("enabled", false),
                wert.optBoolean("roomMinimum", false),
                wert.optBoolean("shareWatchedWithRoom", false));
        } catch (Exception ignored) {
            return new Einstellung(false, false, false);
        }
    }

    static void speichern(SharedPreferences prefs, Einstellung einstellung) {
        try {
            prefs.edit().putString(PREF_KEY, new JSONObject()
                .put("enabled", einstellung.enabled)
                .put("roomMinimum", einstellung.roomMinimum)
                .put("shareWatchedWithRoom", einstellung.shareWatchedWithRoom).toString()).apply();
        } catch (Exception ignored) { }
    }

    /** Whether an episode title and details may be bound into the UI. */
    static boolean sichtbar(Einstellung einstellung, Favorite favorite,
                            int staffel, int episode, Raumstand raumstand) {
        return sichtbar(einstellung, favorite, favorite == null ? null : favorite.abgeschlosseneFolgen(), staffel, episode, raumstand);
    }

    static boolean sichtbar(Einstellung einstellung, Favorite favorite, JSONArray completed,
                            int staffel, int episode, Raumstand raumstand) {
        if (einstellung == null || !einstellung.enabled) return true;
        // Personal mode is always the first gate. Do not infer completion from
        // favorite.episode/currentTime or from a state received from the room.
        if (!enthaelt(completed, staffel, episode)) {
            return false;
        }
        if (!einstellung.roomMinimum || favorite == null || favorite.watchpartyRaum().isEmpty()) {
            return true;
        }
        // Missing relay data means a joined participant may be unknown.
        return raumstand != null && raumstand.known && enthaelt(raumstand.completed, staffel, episode);
    }

    /** Explicit completions across the private and room copies of one series. */
    static JSONArray abgeschlosseneFolgen(Iterable<Favorite> alle, Favorite ziel) {
        JSONArray aus = new JSONArray();
        if (ziel == null || alle == null) return aus;
        String serie = serienKennung(ziel.url());
        if (serie.isEmpty()) return normalisiert(ziel.abgeschlosseneFolgen());
        for (Favorite eintrag : alle) {
            if (eintrag == null || !serie.equals(serienKennung(eintrag.url()))) continue;
            JSONArray jeweils = normalisiert(eintrag.abgeschlosseneFolgen());
            for (int i = 0; i < jeweils.length(); i += 1) aus.put(jeweils.opt(i));
        }
        return normalisiert(aus);
    }

    static String serienKennung(String url) {
        String normal = FavoriteStore.normalizeUrl(url == null ? "" : url);
        return normal.replaceFirst("(?i)/(?:staffel|season)-[0-9]+(?:/(?:episode|folge)-[0-9]+)?/?$", "");
    }

    static boolean enthaelt(JSONArray folgen, int staffel, int episode) {
        if (folgen == null || staffel < 0 || episode <= 0) return false;
        for (int i = 0; i < folgen.length(); i += 1) {
            Object roh = folgen.opt(i);
            if (roh instanceof JSONArray) {
                JSONArray paar = (JSONArray) roh;
                if (ganzeZahl(paar.opt(0), -1) == staffel && ganzeZahl(paar.opt(1), -1) == episode) return true;
            } else if (roh instanceof JSONObject) {
                JSONObject paar = (JSONObject) roh;
                if (ganzeZahl(paar.opt("season"), -1) == staffel && ganzeZahl(paar.opt("episode"), -1) == episode) return true;
            }
        }
        return false;
    }

    static JSONArray normalisiert(JSONArray folgen) {
        JSONArray aus = new JSONArray();
        Set<String> gesehen = new HashSet<>();
        if (folgen == null) return aus;
        for (int i = 0; i < folgen.length(); i += 1) {
            Object roh = folgen.opt(i);
            int staffel = -1;
            int episode = -1;
            if (roh instanceof JSONArray) {
                staffel = ganzeZahl(((JSONArray) roh).opt(0), -1);
                episode = ganzeZahl(((JSONArray) roh).opt(1), -1);
            } else if (roh instanceof JSONObject) {
                staffel = ganzeZahl(((JSONObject) roh).opt("season"), -1);
                episode = ganzeZahl(((JSONObject) roh).opt("episode"), -1);
            }
            String key = staffel + ":" + episode;
            if (staffel >= 0 && episode > 0 && gesehen.add(key)) {
                aus.put(new JSONArray().put(staffel).put(episode));
            }
        }
        return aus;
    }

    private static int ganzeZahl(Object wert, int sonst) {
        if (wert instanceof Number) {
            double d = ((Number) wert).doubleValue();
            return Double.isFinite(d) && d == Math.rint(d) && d >= Integer.MIN_VALUE && d <= Integer.MAX_VALUE
                ? (int) d : sonst;
        }
        if (wert instanceof String && ((String) wert).matches("[0-9]+")) {
            try { return Integer.parseInt((String) wert); } catch (Exception ignored) { }
        }
        return sonst;
    }

    private SpoilerSchutz() { }
}
