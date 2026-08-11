package local.elflix.android;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

public final class ProviderStore {
    private ProviderStore() {
    }

    public static List<Provider> load(Context context) {
        ArrayList<Provider> providers = new ArrayList<>();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(context.getAssets().open("providers.json"), StandardCharsets.UTF_8))) {
            StringBuilder json = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                json.append(line);
            }

            JSONArray array = new JSONArray(json.toString());
            for (int i = 0; i < array.length(); i += 1) {
                JSONObject raw = array.getJSONObject(i);
                Provider provider = new Provider();
                provider.id = raw.optString("id");
                provider.name = raw.optString("name");
                provider.startUrl = raw.optString("startUrl");
                provider.searchUrl = raw.optString("searchUrl");
                provider.logo = raw.optString("logo", provider.name.length() >= 2 ? provider.name.substring(0, 2) : provider.name);
                provider.enabled = raw.optBoolean("enabled", true);
                provider.adblockEnabled = raw.optBoolean("adblockEnabled", true);
                provider.sortOrder = raw.optInt("sortOrder", i);
                provider.searchUrl = Provider.normalizeSearchUrl(provider.searchUrl, provider.startUrl);
                if (provider.enabled && provider.startUrl.startsWith("http")) {
                    providers.add(provider);
                }
            }
        } catch (Exception ignored) {
            Provider fallback = new Provider();
            fallback.id = "aniworld";
            fallback.name = "Aniworld";
            fallback.startUrl = "https://aniworld.to/";
            fallback.searchUrl = "https://aniworld.to/search?q={query}";
            fallback.logo = "AN";
            fallback.enabled = true;
            fallback.adblockEnabled = true;
            providers.add(fallback);
        }
        providers.sort(Comparator.comparingInt(provider -> provider.sortOrder));
        return providers;
    }
}
