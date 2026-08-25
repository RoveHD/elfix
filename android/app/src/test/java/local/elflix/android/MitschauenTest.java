package local.elflix.android;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Woran Android erkennt, ob ein Befehl der Runde die offene Folge meint.
 *
 * <p>Die eine Entscheidung des Mitschauens, die wirklich in Java liegt - alles
 * Uebrige fragt den Kern. Sie liegt hier, weil sie bei jedem eingehenden
 * Befehl gebraucht wird und ein Umweg ueber die Bruecke dafuer zu langsam
 * waere.
 *
 * <p>Und sie ist genau die Stelle, an der ein Fehler wie der gemeldete
 * entsteht: faellt eine Folge faelschlich durch, wirkt Play/Pause nicht mehr;
 * kommt eine fremde durch, pausiert jemand, der etwas ganz anderes schaut.
 */
public class MitschauenTest {

    private static final String BASIS = "https://aniworld.to/anime/stream/naruto";

    @Test
    public void erkenntStaffelUndFolge() {
        assertArrayEquals(new int[]{3, 8},
            Mitschauen.folgeAus(BASIS + "/staffel-3/episode-8"));
        // Die deutschen Schreibweisen ebenso - s.to benutzt sie.
        assertArrayEquals(new int[]{1, 5},
            Mitschauen.folgeAus("https://s.to/serie/stream/test/staffel-1/folge-5"));
        // Ein Film hat keine Folge; die Null ist die Antwort und kein Fehler.
        assertArrayEquals(new int[]{0, 0},
            Mitschauen.folgeAus("https://filmo.to/film/irgendwas"));
        assertArrayEquals(new int[]{0, 0}, Mitschauen.folgeAus(null));
    }

    @Test
    public void dieselbeFolgeBleibtDieselbe() {
        String eine = BASIS + "/staffel-3/episode-8";
        assertTrue(Mitschauen.gleicheFolge(eine, eine));
        // Ein angehaengter Hoster oder eine Sprache macht keine neue Folge:
        // genau daran ist der Vergleich Zeichen fuer Zeichen gescheitert.
        assertTrue(Mitschauen.gleicheFolge(eine, eine + "?hoster=voe"));
        assertTrue(Mitschauen.gleicheFolge(eine, eine + "#sprache-2"));
        assertTrue(Mitschauen.gleicheFolge(eine, eine + "/"));
        // Und www. oder http statt https ebensowenig.
        assertTrue(Mitschauen.gleicheFolge(eine,
            "http://www.aniworld.to/anime/stream/naruto/staffel-3/episode-8"));
    }

    @Test
    public void andereFolgeIstEineAndere() {
        String eine = BASIS + "/staffel-3/episode-8";
        assertFalse(Mitschauen.gleicheFolge(eine, BASIS + "/staffel-3/episode-9"));
        assertFalse(Mitschauen.gleicheFolge(eine, BASIS + "/staffel-4/episode-8"));
        assertFalse(Mitschauen.gleicheFolge(eine,
            "https://aniworld.to/anime/stream/bleach/staffel-3/episode-8"));
        // Und ein anderer Anbieter ist nie dieselbe Folge, auch bei gleichem
        // Titel und gleicher Nummer.
        assertFalse(Mitschauen.gleicheFolge(eine,
            "https://s.to/serie/stream/naruto/staffel-3/episode-8"));
    }

    @Test
    public void leereAngabenSindNieDieselbeFolge() {
        assertFalse(Mitschauen.gleicheFolge(null, BASIS + "/staffel-1/episode-1"));
        assertFalse(Mitschauen.gleicheFolge(BASIS + "/staffel-1/episode-1", ""));
        assertFalse(Mitschauen.gleicheFolge(null, null));
    }

    @Test
    public void derSerienteilLaesstFolgeUndBeiwerkWeg() {
        assertEquals("aniworld.to/anime/stream/naruto",
            Mitschauen.serienTeil(BASIS + "/staffel-3/episode-8?hoster=voe"));
        assertEquals("aniworld.to/anime/stream/naruto", Mitschauen.serienTeil(BASIS + "/"));
        assertEquals("", Mitschauen.serienTeil(null));
    }
}
