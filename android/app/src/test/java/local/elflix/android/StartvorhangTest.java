package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Die Frage, ob die Messung eine Fehleransage widerlegt - ohne Ansicht.
 *
 * <p>Anlass ist der Fall vom 3.9.2026 auf dem Fernseher: der Autostart gab
 * nach vier Versuchen auf und der Vorhang schrieb "Der Player hat kein Video
 * geladen", waehrend der Film lief. Die Rueckmeldung des Players kam vier
 * Sekunden zu spaet und gehoerte da zu keinem Auftrag mehr.
 *
 * <p>Die zweite Quelle ist die Messung. Sie darf aber nur dann widersprechen,
 * wenn sie es wirklich weiss - und das weiss sie erst aus zwei Messungen. Ein
 * stehendes Bild meldet seine Stelle genauso oft wie ein laufendes, nur immer
 * dieselbe. Genau diese Unterscheidung steht hier.
 *
 * <p>Was sich hier nicht pruefen laesst, ist, ob der Vorhang danach wirklich
 * aufgeht: dafuer braucht es ein Geraet. Das steht im Commit.
 */
public class StartvorhangTest {

    @Test
    public void ohneVorherigeMessungGibtEsKeineAuskunft() {
        // So steht es beim ersten Messwert einer Folge da, und beim ersten
        // nach einem Seitenwechsel. Ein einzelner Wert ist kein Vergleich.
        assertFalse(Startvorhang.messungSagtLaeuft(-1, 0));
        assertFalse(Startvorhang.messungSagtLaeuft(-1, 1240));
    }

    @Test
    public void einStehendesBildIstKeinLaufendesVideo() {
        assertFalse(Startvorhang.messungSagtLaeuft(1240, 1240));
        // Der Player meldet gerundet; ein Zehntel Unterschied ist noch Stillstand.
        assertFalse(Startvorhang.messungSagtLaeuft(1240, 1240.1));
        assertFalse(Startvorhang.messungSagtLaeuft(1240, 1240.5));
    }

    @Test
    public void eineVorgeruecktStelleHeisstEsLaeuft() {
        // Der Messtakt kommt alle fuenf Sekunden - so weit ist es dann auch.
        assertTrue(Startvorhang.messungSagtLaeuft(1240, 1245));
        assertTrue(Startvorhang.messungSagtLaeuft(0, 5));
        // Und knapp ueber der Schwelle reicht ebenfalls.
        assertTrue(Startvorhang.messungSagtLaeuft(1240, 1240.6));
    }

    @Test
    public void einSprungZurueckIstKeinBeweis() {
        // Wer im laufenden Film zurueckspult, steht danach frueher. Das sagt
        // ueber "laeuft" nichts aus - der naechste Takt sagt es dann.
        assertFalse(Startvorhang.messungSagtLaeuft(1240, 600));
        assertFalse(Startvorhang.messungSagtLaeuft(1240, 0));
    }

    @Test
    public void derStartVonVornZaehltAuch() {
        // Eine Folge, die bei null anfaengt: die erste Messung steht auf 0,
        // die zweite schon weiter. Genau dieser Fall darf nicht durch die
        // "keine vorherige Messung"-Regel fallen - 0 ist ein Messwert.
        assertFalse(Startvorhang.messungSagtLaeuft(0, 0));
        assertTrue(Startvorhang.messungSagtLaeuft(0, 2));
    }
}
