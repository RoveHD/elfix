package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Wann die Teilnehmerleiste dasteht.
 *
 * <p>Zwei Orte, zwei Regeln. Neben dem Bild gehoert sie hin und verdeckt
 * nichts - dort haengt sie allein daran, ob es ueberhaupt eine Runde gibt. Im
 * Vollbild liegt sie <em>auf</em> dem Video, und dort darf sie nicht dauerhaft
 * stehen: sie kommt mit den Bedienelementen des Players und geht mit ihnen.
 *
 * <p>Der Zustand kommt vom Player selbst - JW Player, den VOE fuehrt, setzt
 * beim Ausblenden eine Klasse an seinem Wurzelknoten, und der Horcher aus
 * {@code watchparty-sync.js} meldet die Aenderung. Ein eigener Zeitgeber
 * daneben waere eine zweite Uhr, die nach ein paar Sekunden anders steht als
 * die des Players; er greift deshalb nur, solange von dort gar nichts kommt.
 */
public class LivestreifenTest {

    @Test
    public void nebenDemBildStehtSieImmer() {
        // Kein Vollbild: was der Player ueber seine Leiste sagt, ist dort ohne
        // Belang - der Streifen liegt neben dem Video und nicht darauf.
        assertTrue(Livestreifen.zeigen(true, false, true));
        assertTrue(Livestreifen.zeigen(true, false, false));
    }

    @Test
    public void imVollbildKommtUndGehtSieMitDerSteuerung() {
        assertTrue(Livestreifen.zeigen(true, true, true));
        assertFalse("blendet der Player aus, verschwindet auch die Leiste",
            Livestreifen.zeigen(true, true, false));
    }

    @Test
    public void ohneRundeStehtSieNirgends() {
        // Gibt es nichts zu zeigen, hilft auch eine sichtbare Player-Steuerung
        // nicht: ein leerer Streifen ueber dem Video waere nur ein Balken.
        assertFalse(Livestreifen.zeigen(false, true, true));
        assertFalse(Livestreifen.zeigen(false, false, true));
    }
}
