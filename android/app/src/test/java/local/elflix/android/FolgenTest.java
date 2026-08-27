package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Wann der Player wirklich am Ende ist - und wann eben nicht.
 *
 * <p>Das ist die eine Regel, die hier und nicht im geteilten Kern steht, und
 * sie hat einen gemeldeten Fehler als Anlass: eine Folge gilt ab 90 Prozent
 * als gesehen, und daraus wurde einmal "also weiterschalten". Wer bei 91
 * Prozent weiterschaut, wurde aus seiner Folge geworfen.
 *
 * <p>Deshalb sind es zwei verschiedene Dinge, und deshalb steht die zweite
 * hier: "gilt als gesehen" entscheidet die geteilte Regel in
 * {@code fortschritt.js}, "ist durchgelaufen" entscheidet {@link Folgen#amEnde}
 * - und nur daran haengt der automatische Wechsel. Dieselbe Trennung wie am
 * Rechner in {@code syncViewMediaProgress}.
 *
 * <p>Daneben die dritte Stufe, die dieselbe Achse in drei Abschnitte teilt:
 * unter neunzig Prozent steht gar nichts, ab neunzig Prozent der Knopf
 * ({@link Folgen#nahAmEnde}), am Ende der Zaehler. Und die Sichtbarkeit der
 * Leiste, weil ein Knopf, der dauerhaft auf dem Video liegt, die
 * Bedienelemente des Hosters verdeckt.
 */
public class FolgenTest {

    /* ------------------------------------------------- Das Ende der Folge */

    @Test
    public void mittenInDerFolgeIstKeinEnde() {
        assertFalse(Folgen.amEnde(10, 1400, false));
        assertFalse(Folgen.amEnde(700, 1400, false));
    }

    @Test
    public void auchSechsUndSiebzigProzentSindKeinEnde() {
        // Der gemeldete Fall: die Folge gilt intern laengst als abgeschlossen,
        // der Zuschauer sitzt aber noch davor.
        assertFalse(Folgen.amEnde(1064, 1400, false));
    }

    @Test
    public void auchNeunzigProzentSindKeinEnde() {
        assertFalse(Folgen.amEnde(1260, 1400, false));
    }

    /* ------------------------------------------------- Ab wann der Knopf */

    @Test
    public void unterNeunzigProzentStehtKeinKnopfDa() {
        assertFalse(Folgen.nahAmEnde(0, 1400, false));
        assertFalse(Folgen.nahAmEnde(700, 1400, false));
        // Auch 76 Prozent nicht - "gilt als gesehen" ist eine andere Frage.
        assertFalse(Folgen.nahAmEnde(1064, 1400, false));
        assertFalse(Folgen.nahAmEnde(1250, 1400, false));
    }

    @Test
    public void gerundetWirdWieAmRechner() {
        // mediaProgressPercent rundet kaufmaennisch; 89,5 Prozent sind damit
        // neunzig. Steht hier, damit die Grenze nicht unbemerkt wandert.
        assertEquals(89, Folgen.prozent(1250, 1400));
        assertEquals(90, Folgen.prozent(1253, 1400));
        assertTrue(Folgen.nahAmEnde(1253, 1400, false));
    }

    @Test
    public void abNeunzigProzentSchon() {
        assertTrue(Folgen.nahAmEnde(1260, 1400, false));
        assertTrue(Folgen.nahAmEnde(1380, 1400, false));
    }

    @Test
    public void amEndeIstEsNichtMehrNurNahDran() {
        // Die beiden schliessen einander aus: dort greift der Zaehler, nicht
        // der blosse Knopf.
        assertTrue(Folgen.amEnde(1400, 1400, false));
        assertFalse(Folgen.nahAmEnde(1400, 1400, false));
        assertFalse(Folgen.nahAmEnde(12, 1400, true));
    }

    @Test
    public void ohneLaufzeitGibtEsAuchKeinenKnopf() {
        assertFalse(Folgen.nahAmEnde(0, 0, false));
    }

    @Test
    public void dieProzentrechnungBleibtImRahmen() {
        assertEquals(0, Folgen.prozent(0, 1400));
        assertEquals(50, Folgen.prozent(700, 1400));
        assertEquals(100, Folgen.prozent(1400, 1400));
        // Manche Hoster melden eine Stelle hinter der Laufzeit.
        assertEquals(100, Folgen.prozent(1402, 1400));
        assertEquals(0, Folgen.prozent(5, 0));
    }

    @Test
    public void dieSchwellenSindDieDesRechners() {
        assertEquals(90, Folgen.KNOPF_AB_PROZENT);
        assertEquals(5, Folgen.ZAEHLER_SEKUNDEN);
    }

    @Test
    public void dieLetztenAnderthalbSekundenZaehlenAlsEnde() {
        assertTrue(Folgen.amEnde(1398.5, 1400, false));
        assertTrue(Folgen.amEnde(1400, 1400, false));
        assertFalse(Folgen.amEnde(1398.0, 1400, false));
    }

    @Test
    public void wasDerPlayerSelbstSagtZaehltImmer() {
        // Manche Hoster bleiben eine Sekunde vor der gemeldeten Laufzeit stehen
        // und schicken trotzdem ein ended.
        assertTrue(Folgen.amEnde(0, 0, true));
        assertTrue(Folgen.amEnde(12, 1400, true));
    }

    @Test
    public void ohneLaufzeitGibtEsKeinEnde() {
        // Ein Player ohne Quelle meldet duration 0. Daraus "fertig" zu machen
        // hiesse, beim Laden der Folge sofort weiterzuschalten.
        assertFalse(Folgen.amEnde(0, 0, false));
        assertFalse(Folgen.amEnde(5, 0, false));
    }

    /* --------------------------------------------------- Was dasteht */

    @Test
    public void folgenTextLiestStaffelUndFolge() {
        assertEquals("Staffel 2 Folge 7",
            Folgen.folgenText("https://aniworld.to/anime/stream/naruto/staffel-2/episode-7"));
        assertEquals("Staffel 12 Folge 3",
            Folgen.folgenText("https://s.to/serie/stream/x/staffel-12/episode-3/"));
    }

    @Test
    public void ohneStaffelBleibtDieFolge() {
        assertEquals("Folge 4", Folgen.folgenText("https://example.com/serie/stream/x/folge-4"));
    }

    @Test
    public void ohneFolgeGibtEsNichtsZuSagen() {
        assertEquals("", Folgen.folgenText("https://aniworld.to/anime/stream/naruto/staffel-2"));
        assertEquals("", Folgen.folgenText(null));
        assertEquals("", Folgen.folgenText("https://aniworld.to/"));
    }

    @Test
    public void kurzeAdresseFuersProtokoll() {
        assertEquals("aniworld.to/anime/stream/x/staffel-1/episode-2",
            Folgen.kurz("https://aniworld.to/anime/stream/x/staffel-1/episode-2?lang=de#top"));
        assertEquals("(leer)", Folgen.kurz(""));
        assertEquals("(leer)", Folgen.kurz(null));
    }

    /*
     * Wie deutlich die Leiste dasteht, stand bis hierher auch hier - vier
     * Faelle, die sich mit denen in SpielerleisteTest ueberschnitten. Sie
     * gehoeren dorthin: das ist die Klasse, deren Regel es ist, und seit die
     * Leiste in drei Schritten geht, gibt es dort mehr zu pruefen als eine
     * Deckkraft. Zwei Orte fuer eine Regel waeren zwei Wahrheiten.
     */
}
