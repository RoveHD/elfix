package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Woran ein YouTube-Eintrag erkannt wird.
 *
 * <p>Der Abgleich ist kurz, seine Wirkung nicht: an ihm hängt, ob ein
 * angefangenes Video in der YouTube-Reihe steht oder die Serienreihe von der
 * Startseite schiebt. Er muss dieselbe Antwort geben wie {@code youtube.js} am
 * Rechner - deshalb steht hier auch der Fall mit den Präfixen: {@code m.},
 * {@code music.} und {@code www.} fallen dort weg, und wer eines davon vergisst,
 * bekommt auf dem Telefon eine andere Einteilung als am Rechner.
 */
public class YoutubeTest {

    private final Youtube youtube = new Youtube(null);

    @Test
    public void dieGewoehnlichenAdressen() {
        assertTrue(youtube.istYoutube("https://www.youtube.com/watch?v=abc"));
        assertTrue(youtube.istYoutube("https://youtube.com/watch?v=abc"));
        assertTrue(youtube.istYoutube("https://youtu.be/abc"));
        assertTrue(youtube.istYoutube("https://www.youtube-nocookie.com/embed/abc"));
    }

    @Test
    public void diePraefixeFallenWeg() {
        assertTrue(youtube.istYoutube("https://m.youtube.com/watch?v=abc"));
        assertTrue(youtube.istYoutube("https://music.youtube.com/watch?v=abc"));
    }

    @Test
    public void unterdomaenenZaehlenMit() {
        assertTrue(youtube.istYoutube("https://gaming.youtube.com/"));
    }

    @Test
    public void anbieterUndUnsinnZaehlenNicht() {
        assertFalse(youtube.istYoutube("https://aniworld.to/anime/stream/naruto"));
        assertFalse(youtube.istYoutube("https://s.to/serie/loki"));
        assertFalse(youtube.istYoutube(""));
        assertFalse(youtube.istYoutube((String) null));
        assertFalse(youtube.istYoutube("kein-url"));
    }

    /**
     * Ein Name, der nur so aussieht.
     *
     * <p>{@code notyoutube.com} endet nicht auf {@code .youtube.com} - die
     * Prüfung darf hier nicht einfach "enthält" meinen.
     */
    @Test
    public void aehnlicheNamenZaehlenNicht() {
        assertFalse(youtube.istYoutube("https://notyoutube.com/watch?v=abc"));
        assertFalse(youtube.istYoutube("https://youtube.com.example.org/"));
    }

    @Test
    public void derWirtWirdKleingeschriebenUndBefreit() {
        assertEquals("youtube.com", Youtube.hostVon("https://WWW.YouTube.COM/watch"));
        assertEquals("youtube.com", Youtube.hostVon("https://m.youtube.com/"));
        assertEquals("", Youtube.hostVon(""));
        assertEquals("", Youtube.hostVon(null));
    }

    /** Ein Eintrag ohne Adresse ist kein YouTube-Eintrag - und wirft auch nicht. */
    @Test
    public void eintragOhneAdresse() {
        assertFalse(youtube.istYoutube((Favorite) null));
    }
}
