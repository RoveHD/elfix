package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Der View-Baum einer langen Entdeckung bleibt klein, auch wenn die Datenliste waechst. */
public class EntdeckungsFensterTest {
    @Test
    public void kleineListeBleibtVollstaendigImFenster() {
        EntdeckungsFenster.Bereich bereich = EntdeckungsFenster.umSichtbareZeilen(25, 0, 4, 2, 10);
        assertEquals(0, bereich.von);
        assertEquals(7, bereich.bis);
    }

    @Test
    public void hunderteZeilenBleibenAufDasFesteFensterBegrenzt() {
        for (int zeilen : new int[]{100, 250, 500}) {
            EntdeckungsFenster.Bereich bereich =
                EntdeckungsFenster.umSichtbareZeilen(zeilen, zeilen / 2, zeilen / 2 + 3, 2, 10);
            assertTrue(bereich.anzahl() <= 10);
            assertTrue(bereich.von <= zeilen / 2);
            assertTrue(bereich.bis > zeilen / 2 + 3);
        }
    }

    @Test
    public void endeBleibtImRasterUndHatKeinenLeerenNachlauf() {
        EntdeckungsFenster.Bereich bereich =
            EntdeckungsFenster.umSichtbareZeilen(100, 97, 99, 2, 10);
        assertEquals(100, bereich.bis);
        assertTrue(bereich.von >= 0);
    }
}
