package local.elflix.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Dieselben Faelle wie tests/sprachsuchetexttest.js am Desktop. */
public class SprachSucheTest {
    @Test public void bereinigtWieAmDesktop() {
        String[][] faelle = {
            {"Avatar die sieben Häfen", "avatar die sieben häfen"},
            {"such nach breaking bad", "breaking bad"},
            {"suche mal nach der serie dark", "dark"},
            {"zeig mir one piece", "one piece"},
            {"spiele game of thrones ab", "game of thrones"},
            {"ich will naruto sehen", "naruto"},
            {"öffne mal bitte den film inception", "inception"},
            {"hey elfix such avatar", "avatar"},
            {"finde attack on titan bitte", "attack on titan"},
            {"  Hunter X Hunter.  ", "hunter x hunter"},
            {"Hey Elf Fix, Breaking Bad", "breaking bad"},
            {"", ""},
        };
        for (String[] fall : faelle) assertEquals(fall[0], fall[1], SprachSuche.bereinigen(fall[0]));
        assertEquals("", SprachSuche.bereinigen(null));
    }
}
