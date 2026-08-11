package local.elflix.android;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public final class FavoriteStore {
    private static final String PREFS = "elflix-favorites";
    private static final String KEY = "favorites";

    private FavoriteStore() {
    }

    public static List<Favorite> load(Context context) {
        ArrayList<Favorite> favorites = new ArrayList<>();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray array = new JSONArray(prefs.getString(KEY, "[]"));
            for (int i = 0; i < array.length(); i += 1) {
                JSONObject raw = array.getJSONObject(i);
                Favorite favorite = new Favorite();
                favorite.id = raw.optString("id", UUID.randomUUID().toString());
                favorite.providerId = raw.optString("providerId");
                favorite.providerName = raw.optString("providerName");
                favorite.title = raw.optString("title", "Favorit");
                favorite.url = raw.optString("url");
                favorite.favicon = raw.optString("favicon");
                favorite.thumbnail = raw.optString("thumbnail");
                favorite.createdAt = raw.optString("createdAt");
                if (favorite.url.startsWith("http")) favorites.add(favorite);
            }
        } catch (Exception ignored) {
        }
        return favorites;
    }

    public static void save(Context context, List<Favorite> favorites) {
        JSONArray array = new JSONArray();
        try {
            for (Favorite favorite : favorites) {
                JSONObject raw = new JSONObject();
                raw.put("id", favorite.id);
                raw.put("providerId", favorite.providerId);
                raw.put("providerName", favorite.providerName);
                raw.put("title", favorite.title);
                raw.put("url", favorite.url);
                raw.put("favicon", favorite.favicon);
                raw.put("thumbnail", favorite.thumbnail);
                raw.put("createdAt", favorite.createdAt);
                array.put(raw);
            }
        } catch (Exception ignored) {
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, array.toString()).apply();
    }

    public static String normalizeUrl(String value) {
        int hash = value.indexOf("#");
        String clean = hash >= 0 ? value.substring(0, hash) : value;
        while (clean.length() > 1 && clean.endsWith("/")) {
            clean = clean.substring(0, clean.length() - 1);
        }
        return clean;
    }
}
