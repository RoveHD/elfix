package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Wohin das Steuerkreuz zeigt - gerechnet, ohne Fernseher.
 *
 * <p>Gemeldet war: "nicht automatisch Reihe nach unten wechseln, wenn man am
 * Ende nach rechts drückt". Der Sprung sah zufällig aus, weil er mitten in die
 * Nachbarreihe ging - auf die siebte, die zwölfte, irgendeine Kachel. Die
 * Erklärung steht bei {@link Reihenfokus}: die Fokussuche von Android schaut
 * sich die ganze Seite an, und die ungescrollten Kacheln einer Nachbarreihe
 * liegen tatsächlich weiter rechts als alles in der eigenen Reihe.
 *
 * <p>Was hier geprüft wird, ist die Rechnung dahinter. Dass links und rechts in
 * der Reihe bleiben, steht in {@link Fokusreihe} und braucht einen Bildschirm;
 * dass oben und unten die <em>Spalte halten</em>, ist diese Rechnung - und
 * genau sie entscheidet, ob der Wechsel nach unten als zufällig empfunden wird
 * oder nicht.
 */
public class ReihenfokusTest {

    /**
     * Die Kachel unter dem Fokus - und nicht die erste der Reihe.
     *
     * <p>Die Zahlen sind ein 1080p-Schirm: Kacheln von 240 Pixeln Breite, die
     * erste bei 120, dann alle 260 die nächste. Der Fokus steht auf der
     * vierten sichtbaren (900), also gehört ihm die vierte darunter.
     */
    @Test
    public void nachUntenGehtDieSpalteMit() {
        int[] mitten = {120, 380, 640, 900, 1160, 1420, 1680};
        assertEquals(3, Reihenfokus.spalteBei(mitten, 900));
        assertEquals(0, Reihenfokus.spalteBei(mitten, 120));
        assertEquals(6, Reihenfokus.spalteBei(mitten, 1680));
    }

    /** Nicht genau darunter, sondern am nächsten: Reihen sind verschieden weit geschoben. */
    @Test
    public void esZaehltDerKuerzesteWeg() {
        int[] mitten = {200, 520, 840};
        assertEquals(1, Reihenfokus.spalteBei(mitten, 500));
        assertEquals(2, Reihenfokus.spalteBei(mitten, 1200));
        assertEquals(0, Reihenfokus.spalteBei(mitten, -400));
    }

    /**
     * Die weit rechts liegende, unsichtbare Kachel gewinnt nicht mehr.
     *
     * <p>Der gemeldete Fall, in Zahlen: die Nachbarreihe hat zwanzig Kacheln,
     * steht aber am Anfang - die zwanzigste liegt bei 5000 und ist nicht zu
     * sehen. Die Fokussuche nahm genau diese ("am weitesten rechts"). Die
     * Spaltenrechnung nimmt die, die unter dem Fokus steht.
     */
    @Test
    public void dieUnsichtbareKachelGewinntNicht() {
        int[] mitten = new int[20];
        for (int i = 0; i < mitten.length; i += 1) mitten[i] = 120 + i * 260;
        int unterDemFokus = Reihenfokus.spalteBei(mitten, 640);
        assertEquals(2, unterDemFokus);
        assertTrue("die letzte ist weit weg", mitten[19] > 4900);
    }

    /** Bei gleichem Abstand die linke - sonst entschiede die Reihenfolge der Kinder. */
    @Test
    public void gleichstandGehtNachLinks() {
        int[] mitten = {100, 300};
        assertEquals(0, Reihenfokus.spalteBei(mitten, 200));
    }

    /** Eine Reihe ohne Kacheln ist kein Ziel - dann bleibt es beim Fund von Android. */
    @Test
    public void ohneKachelnKeinZiel() {
        assertEquals(Reihenfokus.KEINES, Reihenfokus.spalteBei(new int[0], 500));
    }

    /**
     * Im Raster ist am Rand Rand.
     *
     * <p>Vier Spalten, elf Einträge. Die letzte Zeile ist halb leer, und ihr
     * letzter Eintrag ist trotzdem ein rechter Rand - dahinter kommen
     * Platzhalter, und ohne diese Regel sprang der Fokus von dort in die Zeile
     * darüber.
     */
    @Test
    public void dasRasterWechseltAmRandDieZeileNichtMehr() {
        assertTrue("links in der ersten Spalte", Reihenfokus.amRand(0, 4, 11, false));
        assertTrue("links in der zweiten Zeile", Reihenfokus.amRand(4, 4, 11, false));
        assertFalse("mitten in der Zeile", Reihenfokus.amRand(5, 4, 11, false));
        assertTrue("rechts in der letzten Spalte", Reihenfokus.amRand(3, 4, 11, true));
        assertFalse("rechts mitten in der Zeile", Reihenfokus.amRand(1, 4, 11, true));
        assertTrue("der letzte Eintrag ueberhaupt", Reihenfokus.amRand(10, 4, 11, true));
        assertFalse("davor geht es weiter", Reihenfokus.amRand(9, 4, 11, true));
    }

    /** Eine Spalte heisst: jede Zelle ist beidseitig Rand. */
    @Test
    public void eineSpalteIstueberallRand() {
        assertTrue(Reihenfokus.amRand(0, 1, 3, false));
        assertTrue(Reihenfokus.amRand(1, 1, 3, true));
    }

    /** Kein Raster ohne Spalten - und keine Taste, die dann irgendwohin springt. */
    @Test
    public void ohneSpaltenBleibtAllesStehen() {
        assertTrue(Reihenfokus.amRand(0, 0, 5, true));
        assertTrue(Reihenfokus.amRand(0, 0, 5, false));
    }
}
