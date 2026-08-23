package local.elflix.android;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Die Anbieterliste - lesbar aus dem Paket, aenderbar durch den Benutzer.
 *
 * <p>Bisher kam sie ausschliesslich aus {@code assets/providers.json} und war
 * damit unveraenderlich: wer einen Anbieter hinzufuegen, umbenennen oder
 * abschalten wollte, konnte das am Rechner tun und auf dem Telefon nicht. Die
 * Desktop-App legt ihre Liste als Datei ab und faellt nur beim ersten Start auf
 * die eingebauten Vorgaben zurueck - genau das tut diese Klasse jetzt auch.
 *
 * <p>Geordnet und geprueft wird ueber {@code provider-model.js} im Kern,
 * dieselbe Datei wie am Desktop; hier steht nur, woher die Liste kommt und
 * wohin sie geht.
 */
public final class ProviderStore {
    private static final String TAG = CrashReporter.TAG;
    private static final String DATEI = "providers.json";

    private ProviderStore() {
    }

    public static List<Provider> load(Context context) {
        JSONArray roh = ladeRoh(context);
        ArrayList<Provider> providers = new ArrayList<>();
        for (int i = 0; i < roh.length(); i += 1) {
            JSONObject eintrag = roh.optJSONObject(i);
            if (eintrag == null) continue;
            Provider provider = ausJson(eintrag, i);
            if (provider.enabled && provider.startUrl.startsWith("http")) providers.add(provider);
        }
        if (providers.isEmpty()) providers.add(notnagel());
        providers.sort(Comparator.comparingInt(provider -> provider.sortOrder));
        return providers;
    }

    /** Die Liste, wie sie abgelegt ist - auch abgeschaltete Eintraege. */
    public static List<Provider> ladeAlle(Context context) {
        JSONArray roh = ladeRoh(context);
        ArrayList<Provider> providers = new ArrayList<>();
        for (int i = 0; i < roh.length(); i += 1) {
            JSONObject eintrag = roh.optJSONObject(i);
            if (eintrag != null) providers.add(ausJson(eintrag, i));
        }
        providers.sort(Comparator.comparingInt(provider -> provider.sortOrder));
        return providers;
    }

    public static void speichern(Context context, List<Provider> providers) {
        JSONArray roh = new JSONArray();
        for (Provider provider : providers) roh.put(provider.alsAblage());
        File ziel = new File(context.getFilesDir(), DATEI);
        File zwischen = new File(context.getFilesDir(), DATEI + ".neu");
        try (FileOutputStream aus = new FileOutputStream(zwischen)) {
            aus.write(roh.toString().getBytes(StandardCharsets.UTF_8));
            aus.flush();
        } catch (Exception fehler) {
            Log.e(TAG, "Anbieterliste liess sich nicht schreiben", fehler);
            return;
        }
        if (!zwischen.renameTo(ziel) && (!ziel.delete() || !zwischen.renameTo(ziel))) {
            Log.e(TAG, "Anbieterliste liess sich nicht ersetzen");
        }
    }

    /** Setzt die Liste auf die eingebauten Vorgaben zurueck. */
    public static void zuruecksetzen(Context context) {
        File datei = new File(context.getFilesDir(), DATEI);
        if (datei.isFile() && !datei.delete()) {
            Log.e(TAG, "Anbieterliste liess sich nicht zuruecksetzen");
        }
    }

    private static JSONArray ladeRoh(Context context) {
        File datei = new File(context.getFilesDir(), DATEI);
        if (datei.isFile()) {
            try (InputStream strom = new java.io.FileInputStream(datei)) {
                return new JSONArray(stromLesen(strom));
            } catch (Exception fehler) {
                // Eine kaputte Datei darf die App nicht lahmlegen; die
                // eingebauten Vorgaben bringen sie wieder ans Laufen.
                Log.e(TAG, "Abgelegte Anbieterliste unlesbar - es gelten die Vorgaben", fehler);
            }
        }
        try (BufferedReader leser = new BufferedReader(
            new InputStreamReader(context.getAssets().open(DATEI), StandardCharsets.UTF_8))) {
            StringBuilder json = new StringBuilder();
            String zeile;
            while ((zeile = leser.readLine()) != null) json.append(zeile);
            return new JSONArray(json.toString());
        } catch (Exception fehler) {
            Log.e(TAG, "Eingebaute Anbieterliste unlesbar", fehler);
            return new JSONArray();
        }
    }

    private static Provider ausJson(JSONObject raw, int index) {
        Provider provider = new Provider();
        provider.id = raw.optString("id");
        provider.name = raw.optString("name");
        provider.startUrl = raw.optString("startUrl");
        provider.searchUrl = raw.optString("searchUrl");
        provider.logo = raw.optString("logo", provider.name.length() >= 2
            ? provider.name.substring(0, 2) : provider.name);
        provider.enabled = raw.optBoolean("enabled", true);
        provider.adblockEnabled = raw.optBoolean("adblockEnabled", true);
        provider.sortOrder = raw.optInt("sortOrder", index);
        provider.searchUrl = Provider.normalizeSearchUrl(provider.searchUrl, provider.startUrl);
        return provider;
    }

    private static Provider notnagel() {
        Provider fallback = new Provider();
        fallback.id = "aniworld";
        fallback.name = "Aniworld";
        fallback.startUrl = "https://aniworld.to/";
        fallback.searchUrl = "https://aniworld.to/search?q={query}";
        fallback.logo = "AN";
        fallback.enabled = true;
        fallback.adblockEnabled = true;
        return fallback;
    }

    private static String stromLesen(InputStream strom) throws Exception {
        ByteArrayOutputStream puffer = new ByteArrayOutputStream(4096);
        byte[] block = new byte[8192];
        int gelesen;
        while ((gelesen = strom.read(block)) > 0) puffer.write(block, 0, gelesen);
        return puffer.toString(StandardCharsets.UTF_8.name());
    }
}
