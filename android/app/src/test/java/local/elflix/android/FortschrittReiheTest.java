package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/** Regression fuer zurueckspringende TV-Folgen bei parallelen Kernaufrufen. */
public class FortschrittReiheTest {

    @Test
    public void eineAeltereAntwortKannEineSpaetereFolgeNichtUeberholen() {
        FortschrittReihe<String> reihe = new FortschrittReihe<>();
        reihe.hinzufuegen("folge-3@120", FortschrittReiheTest::selbeFolge);
        assertEquals("folge-3@120", reihe.beginnen());

        reihe.hinzufuegen("folge-4@5", FortschrittReiheTest::selbeFolge);
        reihe.hinzufuegen("folge-4@10", FortschrittReiheTest::selbeFolge);

        // Solange Folge 3 im Kern gerechnet wird, bleibt Folge 4 dahinter.
        assertEquals("folge-3@120", reihe.aktuell());
        assertEquals(2, reihe.groesse());
        reihe.abschliessen();
        assertEquals("folge-4@10", reihe.beginnen());
    }

    @Test
    public void verschiedeneFolgenWerdenNichtZusammengelegt() {
        FortschrittReihe<String> reihe = new FortschrittReihe<>();
        reihe.hinzufuegen("folge-3@120", FortschrittReiheTest::selbeFolge);
        reihe.hinzufuegen("folge-4@10", FortschrittReiheTest::selbeFolge);
        reihe.hinzufuegen("folge-5@10", FortschrittReiheTest::selbeFolge);

        assertEquals(3, reihe.groesse());
        assertEquals("folge-3@120", reihe.beginnen());
        assertNull(reihe.beginnen());
        reihe.abschliessen();
        assertEquals("folge-4@10", reihe.beginnen());
        reihe.abschliessen();
        assertEquals("folge-5@10", reihe.beginnen());
    }

    private static boolean selbeFolge(String links, String rechts) {
        return links.substring(0, links.indexOf('@'))
            .equals(rechts.substring(0, rechts.indexOf('@')));
    }
}
