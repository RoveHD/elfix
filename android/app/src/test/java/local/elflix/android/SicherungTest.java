package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.Arrays;
import java.util.List;

/** Regressionen fuer den Android-Sicherungsinhalt und seine Aufbewahrung. */
public final class SicherungTest {
    @Test
    public void sichertAnbieterMitSchalterUndWerbefilterStand() throws Exception {
        Provider provider = new Provider();
        provider.id = "eigener";
        provider.name = "Eigener Anbieter";
        provider.startUrl = "https://example.invalid/";
        provider.searchUrl = "https://example.invalid/search?q={query}";
        provider.logo = "EA";
        provider.enabled = false;
        provider.adblockEnabled = false;
        provider.sortOrder = 7;

        JSONArray gesichert = Sicherung.anbieterSichern(Arrays.asList(provider));

        assertEquals(1, gesichert.length());
        JSONObject eintrag = gesichert.getJSONObject(0);
        assertFalse(eintrag.getBoolean("enabled"));
        assertFalse(eintrag.getBoolean("adblockEnabled"));
        assertEquals(7, eintrag.getInt("sortOrder"));
        assertEquals("https://example.invalid/", eintrag.getString("startUrl"));
    }

    @Test
    public void raeumtGemischteAnlaesseNachZeitstempelAuf() {
        List<String> namen = Arrays.asList(
            "ELFIX-vor-update-20250101-000000.elfix.json",
            "ELFIX-vor-dem-einlesen-20260901-000000.elfix.json",
            "ELFIX-vor-update-20260902-000000.elfix.json",
            "ELFIX-hand-20260903-000000.elfix.json",
            "ELFIX-vor-dem-einlesen-20260904-000000.elfix.json",
            "ELFIX-vor-update-20260905-000000.elfix.json");

        List<String> weg = Sicherung.alteSicherungen(namen, 5);

        assertEquals(Arrays.asList("ELFIX-vor-update-20250101-000000.elfix.json"), weg);
        assertFalse(weg.contains("ELFIX-vor-dem-einlesen-20260901-000000.elfix.json"));
    }
}
