package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

/** Dieselben Faelle wie suchumlauttest.js/suchvariantentest.js am Rechner. */
public class SuchAbgleichTest {
    private static final String PFAD = "serie avatar die sieben hafen";

    private static List<String> t(String... w) { return Arrays.asList(w); }

    @Test public void umlauteAufBeidenSeitenGleich() {
        assertTrue(SuchAbgleich.passt(PFAD, "", t("sieben", "haefen", "avatar"), true));
        assertTrue(SuchAbgleich.passt(PFAD, "", t("avatar", "die", "sieben", "hafen"), true));
        assertTrue("Jahr zaehlt nicht", SuchAbgleich.passt(PFAD, "", t("avatar", "sieben", "haefen", "2026"), true));
        assertFalse(SuchAbgleich.passt("serie avatar der herr der elemente", "", t("sieben", "haefen", "avatar"), true));
        assertTrue("Nur ein Jahr zaehlt dann doch", SuchAbgleich.passt("film 1917", "", t("1917"), true));
    }

    @Test public void kernwoerterWieAmRechner() {
        assertEquals(t("Sieben", "avatar"), SuchAbgleich.kernwoerter("Sieben hafen avatar"));
        assertEquals(t("Avatar", "sieben"), SuchAbgleich.kernwoerter("Avatar - Die sieben Häfen"));
        assertEquals(t(), SuchAbgleich.kernwoerter("Avatar"));
        assertEquals(t(), SuchAbgleich.kernwoerter("Die Avatar"));
    }

    @Test public void schreibweisen() {
        assertEquals("Avatar - Die sieben Häfen", SuchAbgleich.ohneJahr("Avatar - Die sieben Häfen (2026)"));
        assertEquals("Dark", SuchAbgleich.ohneJahr("Dark"));
        assertEquals("avatar die sieben hafen", SuchAbgleich.ohneUmlautE("Avatar die sieben Häfen"));
    }
}
