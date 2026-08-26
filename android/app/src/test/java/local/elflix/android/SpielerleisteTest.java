package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Die beiden Sichtbarkeitsregeln der Wiedergabeleiste - ohne Ansicht.
 *
 * <p>Geprueft wird genau das, was der gemeldete Fehler war: "Autoplay" und
 * "Naechste Folge" waren <em>ein</em> Element und hatten deshalb zwangslaeufig
 * eine Regel. Jetzt sind es zwei, und die beiden Regeln sind ausdruecklich
 * verschieden - die Leiste tritt zurueck, der Schalter geht weg.
 *
 * <p>Was sich hier nicht pruefen laesst, ist der Platz auf dem Schirm und ob
 * ein {@code GONE}-Element wirklich keinen Fokus mehr annimmt. Dafuer braucht
 * es ein Geraet; das steht im Commit.
 */
public class SpielerleisteTest {

    @Test
    public void derSchalterGehtMitDerBedienleisteDesPlayers() {
        // Nichts laeuft: dann gibt es auch nichts einzustellen.
        assertFalse(Spielerleiste.autoplaySichtbar(false, true, false));
        assertFalse(Spielerleiste.autoplaySichtbar(false, false, false));

        // Es laeuft und die Bedienelemente stehen: der Schalter steht mit.
        assertTrue(Spielerleiste.autoplaySichtbar(true, true, false));

        // Die Bedienelemente sind weg: der Schalter auch. Das ist der Kern der
        // Aenderung - vorher wurde er nur durchsichtig und nahm weiter Platz,
        // Fokus und Beruehrungen.
        assertFalse(Spielerleiste.autoplaySichtbar(true, false, false));

        // Ausser waehrend des Zaehlers: eine Ansage, die man nicht abschalten
        // kann, ohne erst das Bild anzutippen, waere keine.
        assertTrue(Spielerleiste.autoplaySichtbar(true, false, true));
    }

    /**
     * Die Leiste tritt zurueck, sie verschwindet nicht.
     *
     * <p>Steht hier als Gegenstueck: waere das je gleich, waere der Weg zur
     * naechsten Folge wieder unsichtbar - der Fehler, aus dem
     * {@code RUHE_DECKKRAFT} ueberhaupt entstanden ist.
     */
    @Test
    public void dieLeisteVerschwindetNie() {
        assertEquals(1f, Spielerleiste.deckkraft(false, false, false), 0.0001f);
        assertEquals(1f, Spielerleiste.deckkraft(true, true, false), 0.0001f);
        assertEquals(1f, Spielerleiste.deckkraft(true, false, true), 0.0001f);
        // Zurueckgetreten - aber nicht auf null.
        float ruhe = Spielerleiste.deckkraft(true, false, false);
        assertTrue("Die Leiste darf nie unsichtbar werden", ruhe > 0f);
        assertTrue(ruhe < 1f);
    }

    /**
     * Die beiden Regeln haengen nicht aneinander.
     *
     * <p>Der Fall aus der Meldung: die Bedienelemente des Players sind weg. Der
     * Schalter ist dann fort, die Leiste steht weiter da - nur leiser.
     */
    @Test
    public void schalterUndLeisteEntscheidenGetrennt() {
        boolean schalter = Spielerleiste.autoplaySichtbar(true, false, false);
        float leiste = Spielerleiste.deckkraft(true, false, false);
        assertFalse(schalter);
        assertTrue(leiste > 0f);
    }
}
