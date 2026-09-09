package local.elflix.android;

import static org.junit.Assert.*;
import org.junit.Test;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public class TvNachladungTest {
    private final ArrayDeque<Runnable> frames = new ArrayDeque<>();
    private final List<Integer> gebaut = new ArrayList<>();
    private boolean aktuell = true;

    private TvNachladung reihe(int vorrat) {
        return new TvNachladung(vorrat, 8, () -> aktuell, frames::add, gebaut::add);
    }

    @Test public void fokusBleibtFreiUndProFrameKommenHoechstensZweiKarten() {
        TvNachladung reihe = reihe(20);
        reihe.anfordern(4);
        assertTrue(frames.isEmpty());
        reihe.anfordern(5);
        assertTrue("Kein Kartenbau im Fokus-Callback", gebaut.isEmpty());
        frames.remove().run();
        assertEquals(Arrays.asList(8, 9), gebaut);
        frames.remove().run();
        assertEquals(Arrays.asList(8, 9, 10, 11), gebaut);
        frames.remove().run();
        assertEquals(Arrays.asList(8, 9, 10, 11, 12, 13), gebaut);
        assertTrue(frames.isEmpty());
    }

    @Test public void schnelleFokuswechselErzeugenKeineDoppeltenKarten() {
        TvNachladung reihe = reihe(19);
        reihe.anfordern(5);
        reihe.anfordern(6);
        reihe.anfordern(7);
        assertEquals(1, frames.size());
        frames.remove().run();
        reihe.anfordern(9);
        reihe.anfordern(8);
        assertEquals(1, frames.size());
        while (!frames.isEmpty()) frames.remove().run();
        reihe.anfordern(15);
        while (!frames.isEmpty()) frames.remove().run();
        assertEquals(Arrays.asList(8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18), gebaut);
    }

    @Test public void verlasseneSeiteBautKeineWeiterenKarten() {
        TvNachladung reihe = reihe(20);
        reihe.anfordern(7);
        frames.remove().run();
        aktuell = false;
        frames.remove().run();
        assertEquals(Arrays.asList(8, 9), gebaut);
        reihe.anfordern(9);
        assertTrue(frames.isEmpty());
    }

    @Test public void kurzeUndVollstaendigeReihenLadenNichtNach() {
        reihe(0).anfordern(0);
        reihe(3).anfordern(2);
        reihe(8).anfordern(7);
        assertTrue(frames.isEmpty());
        assertTrue(gebaut.isEmpty());
    }
}
