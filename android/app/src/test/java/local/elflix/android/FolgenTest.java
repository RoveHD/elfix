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
 * <p>Die Sichtbarkeit der Leiste steht daneben, weil sie dieselbe Frage aus
 * der anderen Richtung stellt: ein Knopf, der dauerhaft auf dem Video liegt,
 * verdeckt die Bedienelemente des Hosters.
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

    /* ------------------------------------------ Wann die Leiste dasteht */

    @Test
    public void nebenDemBildStehtDieLeisteImmer() {
        // Ausserhalb des Vollbilds verdeckt sie nichts - dort haengt sie allein
        // daran, ob ueberhaupt eine Folge offen ist.
        assertTrue(Spielerleiste.zeigen(true, false, false));
        assertTrue(Spielerleiste.zeigen(true, false, true));
    }

    @Test
    public void imVollbildGehtSieMitDenBedienelementen() {
        assertTrue(Spielerleiste.zeigen(true, true, true));
        assertFalse(Spielerleiste.zeigen(true, true, false));
    }

    @Test
    public void ohneFolgeStehtSieNirgends() {
        assertFalse(Spielerleiste.zeigen(false, false, true));
        assertFalse(Spielerleiste.zeigen(false, true, true));
    }
}
