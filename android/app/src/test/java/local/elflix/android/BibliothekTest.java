package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/**
 * Die Listen von „Meine Liste" - und die neue Trennung darin.
 *
 * <p>Gemeldet als Wunsch: „Weiterschauen" und „Gemeinsam weiterschauen"
 * gehören auch in „Meine Liste" getrennt. Auf der Startseite waren sie es
 * längst - zwei Reihen, geschieden am Watchparty-Raum -, in der Bibliothek
 * standen sie zusammen, und ein Titel, den man mit jemandem schaut, stand
 * mitten zwischen den eigenen.
 *
 * <p>Geprüft wird die Regel selbst und nicht die Ansicht: an welchem Merkmal
 * geschieden wird, dass beide Listen zusammen wieder das Ganze ergeben und
 * dass die Reihenfolge dabei erhalten bleibt. Sie ist dieselbe Frage wie in
 * {@code renderMobileHome} - ein Eintrag mit Raum ist gemeinsam, jeder andere
 * ist der eigene.
 */
public class BibliothekTest {

    private static Favorite eintrag(String titel, String raum) throws Exception {
        JSONObject roh = new JSONObject();
        roh.put("id", titel);
        roh.put("title", titel);
        roh.put("url", "https://aniworld.to/anime/stream/" + titel);
        roh.put("type", "serie");
        roh.put("season", 1);
        roh.put("episode", 2);
        if (raum != null) roh.put("watchpartyRoom", raum);
        return new Favorite(roh);
    }

    private static List<Favorite> gemischt() throws Exception {
        List<Favorite> alle = new ArrayList<>();
        alle.add(eintrag("eigen-a", null));
        alle.add(eintrag("gemeinsam-a", "salon"));
        alle.add(eintrag("eigen-b", ""));
        alle.add(eintrag("gemeinsam-b", "bangus"));
        return alle;
    }

    @Test
    public void weiterschauenZeigtNurWasKeinenRaumHat() throws Exception {
        List<Favorite> eigen = Bibliothek.nachRaum(gemischt(), false);
        assertEquals(2, eigen.size());
        for (Favorite eintrag : eigen) {
            assertTrue(eintrag.watchpartyRaum().isEmpty());
        }
    }

    @Test
    public void gemeinsamZeigtNurWasZuEinemRaumGehoert() throws Exception {
        List<Favorite> zusammen = Bibliothek.nachRaum(gemischt(), true);
        assertEquals(2, zusammen.size());
        for (Favorite eintrag : zusammen) {
            assertFalse(eintrag.watchpartyRaum().isEmpty());
        }
    }

    /**
     * Kein Eintrag faellt zwischen die beiden Listen - und keiner steht doppelt.
     *
     * <p>Das ist der eigentliche Punkt der Trennung: sie ist eine Teilung und
     * keine Auswahl. Ginge dabei etwas verloren, waere ein angefangener Titel
     * ueberhaupt nicht mehr zu finden.
     */
    @Test
    public void beideZusammenSindWiederAlle() throws Exception {
        List<Favorite> alle = gemischt();
        List<Favorite> eigen = Bibliothek.nachRaum(alle, false);
        List<Favorite> zusammen = Bibliothek.nachRaum(alle, true);
        assertEquals(alle.size(), eigen.size() + zusammen.size());

        HashSet<String> gesehen = new HashSet<>();
        for (Favorite eintrag : eigen) assertTrue(gesehen.add(eintrag.id()));
        for (Favorite eintrag : zusammen) assertTrue(gesehen.add(eintrag.id()));
        assertEquals(alle.size(), gesehen.size());
    }

    /** Die Reihenfolge der Ablage bleibt - sie ist die nach zuletzt gesehen. */
    @Test
    public void dieReihenfolgeBleibtStehen() throws Exception {
        List<Favorite> eigen = Bibliothek.nachRaum(gemischt(), false);
        assertEquals("eigen-a", eigen.get(0).title());
        assertEquals("eigen-b", eigen.get(1).title());
    }

    /**
     * Was an „angefangen" haengt, gilt fuer beide.
     *
     * <p>„Naechste Folge:" statt der laufenden, der Fortschrittsbalken und der
     * Menuepunkt „Aus Weiterschauen nehmen" fragen nicht mehr nach der einen
     * Liste, sondern nach dieser Eigenschaft - sonst haette die neue Liste sie
     * alle verloren.
     */
    @Test
    public void gemeinsamIstAngefangenesWieWeiterschauen() {
        assertTrue(Bibliothek.WEITERSCHAUEN.zeigtAngefangenes());
        assertTrue(Bibliothek.GEMEINSAM.zeigtAngefangenes());
        assertTrue(Bibliothek.GEMEINSAM.zeigtFortschritt());
        assertFalse(Bibliothek.WATCHLIST.zeigtAngefangenes());
        assertFalse(Bibliothek.MEDIATHEK.zeigtAngefangenes());
        assertFalse(Bibliothek.VERLAUF.zeigtAngefangenes());
    }

    /** Die Kennungen wandern ueber den Geraeteabgleich - keine darf doppelt sein. */
    @Test
    public void jedeKennungStehtGenauEinmal() {
        HashSet<String> gesehen = new HashSet<>();
        for (Bibliothek liste : Bibliothek.values()) {
            assertTrue("Kennung doppelt: " + liste.kennung, gesehen.add(liste.kennung));
            assertEquals(liste, Bibliothek.ausKennung(liste.kennung));
        }
        assertEquals(Bibliothek.values().length, gesehen.size());
    }
}
