package local.elflix.android;

import org.junit.Test;
import static org.junit.Assert.*;

public class SprachchatLautstaerkeTest {
    @Test public void absenkenErhaeltBenutzerLautstaerkeUndStumm() {
        assertEquals(0.175f, DirektSpieler.sprachchatLautstaerke(0.5f, true), 0.0001f);
        assertEquals(0.5f, DirektSpieler.sprachchatLautstaerke(0.5f, false), 0.0001f);
        assertEquals(0f, DirektSpieler.sprachchatLautstaerke(0f, true), 0.0001f);
        assertEquals(0.28f, DirektSpieler.sprachchatLautstaerke(0.8f, true), 0.0001f);
        assertEquals(0.8f, DirektSpieler.sprachchatLautstaerke(0.8f, false), 0.0001f);
    }
}
