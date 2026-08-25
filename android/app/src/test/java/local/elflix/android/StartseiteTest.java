package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.HashSet;

/**
 * Die Liste der Startseitenreihen.
 *
 * <p>Geprüft wird nicht, dass es Schalter gibt, sondern <em>welche</em>: die
 * Schlüssel müssen dieselben sein wie am Rechner ({@code settings.home}), weil
 * sie später über denselben Geräteabgleich wandern. Ein Tippfehler in einem
 * Schlüssel fällt sonst erst auf, wenn zwei Geräte verschiedene Reihen
 * ausblenden - und dann ist er schon in den Daten.
 */
public class StartseiteTest {

    @Test
    public void schluesselSindDieDesRechners() {
        assertEquals("showHero", Startseite.HERO);
        assertEquals("showFavorites", Startseite.WEITERSCHAUEN);
        assertEquals("showYoutube", Startseite.YOUTUBE);
        assertEquals("showPersonal", Startseite.PERSOENLICH);
        assertEquals("showCategories", Startseite.KATEGORIEN);
        assertEquals("showReview", Startseite.RUECKBLICK);
    }

    @Test
    public void jederSchluesselStehtGenauEinmal() {
        HashSet<String> gesehen = new HashSet<>();
        for (Startseite.Reihe reihe : Startseite.REIHEN) {
            assertTrue("Schluessel doppelt: " + reihe.schluessel, gesehen.add(reihe.schluessel));
        }
        assertEquals(gesehen.size(), Startseite.REIHEN.size());
    }

    @Test
    public void jedeReiheHatTitelUndErklaerung() {
        for (Startseite.Reihe reihe : Startseite.REIHEN) {
            assertFalse(reihe.titel.trim().isEmpty());
            assertFalse("Ohne Erklaerung ist ein Schalter ein Raetsel: " + reihe.schluessel,
                reihe.erklaerung.trim().isEmpty());
        }
    }

    /**
     * Der Rückblick beginnt aus - genau wie {@code showReview} am Rechner.
     *
     * <p>Eine Reihe, die "0 Stunden" zeigt, weil noch nie etwas gemessen wurde,
     * ist keine Einladung, sondern ein Vorwurf.
     */
    @Test
    public void nurDerRueckblickBeginntAus() {
        for (Startseite.Reihe reihe : Startseite.REIHEN) {
            if (Startseite.RUECKBLICK.equals(reihe.schluessel)) {
                assertFalse(reihe.vorgabe);
            } else {
                assertTrue("Diese Reihe sollte an sein: " + reihe.schluessel, reihe.vorgabe);
            }
        }
    }

    @Test
    public void unbekannteSchluesselGeltenAlsAn() {
        assertTrue(Startseite.vorgabe("gibtEsNicht"));
    }

    /** Der Kalender ist eine eigene Reihe - am Rechner ist er eine eigene Seite. */
    @Test
    public void derKalenderStehtInDerListe() {
        boolean gefunden = false;
        for (Startseite.Reihe reihe : Startseite.REIHEN) {
            if (Startseite.KALENDER.equals(reihe.schluessel)) gefunden = true;
        }
        assertTrue(gefunden);
        assertTrue(Startseite.vorgabe(Startseite.KALENDER));
    }
}
