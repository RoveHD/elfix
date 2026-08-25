package local.elflix.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * Welches Bild ein Suchtreffer bekommt.
 *
 * <p>Die Ausschnitte sind so gebaut, wie Trefferlisten wirklich aussehen: ein
 * Verweis, darin ein Bild, oft verzoegert geladen und mit einem Pixel im
 * {@code src}. Genau dort holte man sich sonst das Pixel statt des Posters.
 *
 * <p>Der zweite Teil ist wichtiger als der erste: was nicht als Titelbild
 * durchgehen darf. Ein Logo oder ein Sprachabzeichen auf der Karte sieht
 * kaputter aus als der gestaltete Platzhalter.
 */
public class TrefferbildTest {

    private static final String BASIS = "https://beispiel.tld/suche?q=bleach";

    @Test
    public void nimmtDasBildAusDemVerweis() {
        assertEquals("https://beispiel.tld/cover/bleach.jpg",
            Trefferbild.ausMarkup(
                "<a href=\"/anime/bleach\"><img src=\"/cover/bleach.jpg\"><span>Bleach</span></a>",
                BASIS));
    }

    @Test
    public void loestRelativeUndSchemalosemAdressenAuf() {
        assertEquals("https://bilder.tld/a.jpg",
            Trefferbild.ausMarkup("<img src=\"//bilder.tld/a.jpg\">", BASIS));
        assertEquals("https://beispiel.tld/suche/a.jpg",
            Trefferbild.ausMarkup("<img src=\"a.jpg\">", "https://beispiel.tld/suche/"));
        assertEquals("https://beispiel.tld/cover/a.jpg",
            Trefferbild.ausMarkup("<img src=\"/cover/a.jpg\">", "https://beispiel.tld/suche/x"));
    }

    @Test
    public void verzoegertGeladeneAdressenGehenVor() {
        // Steht ein data-src da, ist das src meist nur der Platzhalter.
        assertEquals("https://beispiel.tld/cover/echt.jpg",
            Trefferbild.ausMarkup(
                "<img src=\"/img/placeholder.png\" data-src=\"/cover/echt.jpg\">", BASIS));
    }

    @Test
    public void ausEinerAuswahllisteKommtDieGroessteFassung() {
        assertEquals("https://beispiel.tld/cover/gross.jpg",
            Trefferbild.ausMarkup(
                "<img srcset=\"/cover/klein.jpg 200w, /cover/gross.jpg 800w\" src=\"/cover/klein.jpg\">",
                BASIS));
        assertEquals("https://beispiel.tld/cover/zweifach.jpg",
            Trefferbild.ausMarkup(
                "<img srcset=\"/cover/einfach.jpg 1x, /cover/zweifach.jpg 2x\">", BASIS));
    }

    @Test
    public void findetDasBildAuchAlsHintergrund() {
        assertEquals("https://beispiel.tld/cover/bleach.jpg",
            Trefferbild.ausMarkup(
                "<a href=\"/x\"><div style=\"background-image:url('/cover/bleach.jpg')\"></div></a>",
                BASIS));
    }

    @Test
    public void findetDasBildInEinerDatenangabe() {
        assertEquals("https://beispiel.tld/cover/bleach.jpg",
            Trefferbild.ausMarkup("<div data-thumb=\"/cover/bleach.jpg\"></div>", BASIS));
    }

    @Test
    public void loestKaufmannsUndInDerAdresseAuf() {
        assertEquals("https://beispiel.tld/bild?id=7&s=400",
            Trefferbild.ausMarkup("<img src=\"/bild?id=7&amp;s=400\">", BASIS));
    }

    /* ------------------------------------------------- Was kein Titelbild ist */

    @Test
    public void nimmtKeinLogoUndKeinAbzeichen() {
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/assets/logo.png\">", BASIS));
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/img/sprite.png\">", BASIS));
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/img/flags/de.png\">", BASIS));
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/static/icon-play.png\">", BASIS));
    }

    @Test
    public void nimmtKeinenPlatzhalter() {
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/img/placeholder.png\">", BASIS));
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/img/1x1.gif\">", BASIS));
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/img/transparent.gif\">", BASIS));
    }

    @Test
    public void nimmtKeineZeichnung() {
        // SVG ist auf diesen Seiten das Format der Symbole, nicht der Poster.
        assertEquals("", Trefferbild.ausMarkup("<img src=\"/cover/bleach.svg\">", BASIS));
    }

    @Test
    public void nimmtNurHttpUndHttps() {
        assertEquals("", Trefferbild.ausMarkup(
            "<img src=\"data:image/gif;base64,R0lGODlhAQABAAAAACw=\">", BASIS));
        assertEquals("", Trefferbild.ausMarkup("<img src=\"javascript:0\">", BASIS));
    }

    @Test
    public void geht_ueber_das_Beiwerk_hinweg_zum_echten_Bild() {
        // Der erste Treffer im Verweis ist oft das Abzeichen. Es zaehlt nicht,
        // und die Suche geht weiter statt aufzugeben.
        assertEquals("https://beispiel.tld/cover/bleach.jpg",
            Trefferbild.ausMarkup(
                "<a href=\"/x\"><img src=\"/img/flags/de.png\">"
                    + "<img src=\"/cover/bleach.jpg\"></a>", BASIS));
    }

    @Test
    public void ohneBildBleibtEsLeer() {
        assertEquals("", Trefferbild.ausMarkup("<a href=\"/x\">Bleach</a>", BASIS));
        assertEquals("", Trefferbild.ausMarkup("", BASIS));
        assertEquals("", Trefferbild.ausMarkup(null, BASIS));
    }
}
