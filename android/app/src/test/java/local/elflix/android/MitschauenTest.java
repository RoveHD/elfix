package local.elflix.android;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

import java.lang.reflect.Method;
import java.util.HashSet;
import java.util.Set;

/**
 * Woran Android erkennt, ob ein Befehl der Runde die offene Folge meint.
 *
 * <p>Die eine Entscheidung des Mitschauens, die wirklich in Java liegt - alles
 * Uebrige fragt den Kern. Sie liegt hier, weil sie bei jedem eingehenden
 * Befehl gebraucht wird und ein Umweg ueber die Bruecke dafuer zu langsam
 * waere.
 *
 * <p>Und sie ist genau die Stelle, an der ein Fehler wie der gemeldete
 * entsteht: faellt eine Folge faelschlich durch, wirkt Play/Pause nicht mehr;
 * kommt eine fremde durch, pausiert jemand, der etwas ganz anderes schaut.
 */
public class MitschauenTest {

    private static final String BASIS = "https://aniworld.to/anime/stream/naruto";

    /**
     * Ein wieder angeschlossenes Android-Geraet kann die Vorbereitung der
     * neuen Folge verpassen und erst den gemeinsamen Start sehen. Dann muss
     * genau dieser Start die neue Folge nachholen. Er darf weder eine fremde
     * Serie oeffnen noch eine andere Runde oder eine Nachricht ohne
     * Relay-Generation wiederbeleben.
     */
    @Test
    public void verpassterGemeinsamerStartHoltNurDasExakteFolgenzielNach() throws Exception {
        Method pruefen = Mitschauen.class.getDeclaredMethod("verpassterFolgenstart",
            JSONObject.class, String.class, String.class, String.class);
        pruefen.setAccessible(true);

        String offen = BASIS + "/staffel-1/episode-4";
        JSONObject start = new JSONObject()
            .put("action", "syncstart")
            .put("syncId", "wechsel-5")
            .put("key", "serie:naruto")
            .put("room", "salon")
            .put("url", BASIS + "/staffel-1/episode-5")
            .put("episodeId", "s1e5");

        assertTrue((Boolean) pruefen.invoke(null, start, offen, "serie:naruto", "salon"));
        assertTrue((Boolean) pruefen.invoke(null,
            new JSONObject(start.toString()).put("playing", false),
            offen, "serie:naruto", "salon"));
        assertFalse((Boolean) pruefen.invoke(null, start, start.getString("url"),
            "serie:naruto", "salon"));
        assertFalse((Boolean) pruefen.invoke(null, start, offen, "serie:naruto", "kueche"));
        assertFalse((Boolean) pruefen.invoke(null,
            new JSONObject(start.toString()).put("url",
                "https://aniworld.to/anime/stream/bleach/staffel-1/episode-5"),
            offen, "serie:naruto", "salon"));
        JSONObject ohneGeneration = new JSONObject(start.toString());
        ohneGeneration.remove("syncId");
        assertFalse((Boolean) pruefen.invoke(null, ohneGeneration,
            offen, "serie:naruto", "salon"));
        assertFalse((Boolean) pruefen.invoke(null,
            new JSONObject(start.toString()).put("action", "play"),
            offen, "serie:naruto", "salon"));

        Method markieren = Mitschauen.class.getDeclaredMethod("nachholMarke", JSONObject.class);
        markieren.setAccessible(true);
        String salon = (String) markieren.invoke(null, start);
        String kueche = (String) markieren.invoke(null,
            new JSONObject(start.toString()).put("room", "kueche"));
        String andererTitel = (String) markieren.invoke(null,
            new JSONObject(start.toString()).put("key", "serie:bleach"));
        assertFalse("Dieselbe Relay-Nummer in anderem Raum kollidiert", salon.equals(kueche));
        assertFalse("Dieselbe Relay-Nummer an anderem Titel kollidiert",
            salon.equals(andererTitel));
    }

    @Test
    public void bereiterNachholstartRaeumtErstDieGenerationAufUndGleichtDannFrischAb()
        throws Exception {
        JSONObject start = new JSONObject()
            .put("action", "syncstart")
            .put("syncId", "catchup-7")
            .put("key", "serie:naruto")
            .put("room", "salon")
            .put("url", BASIS + "/staffel-1/episode-5")
            .put("episodeId", "s1e5")
            .put("playing", false);
        Method markieren = Mitschauen.class.getDeclaredMethod("nachholMarke", JSONObject.class);
        markieren.setAccessible(true);
        String marke = (String) markieren.invoke(null, start);
        Set<String> offen = new HashSet<>();
        offen.add(marke);
        int[] abgleiche = { 0 };

        assertTrue(Mitschauen.nachholStartAbschliessen(offen, start, () -> {
            assertFalse("Der alte Marker lebt beim frischen Abgleich noch", offen.contains(marke));
            abgleiche[0] += 1;
        }));
        assertEquals(1, abgleiche[0]);
        assertFalse("Die gleiche Ready-Meldung loest einen zweiten Abgleich aus",
            Mitschauen.nachholStartAbschliessen(offen, start, () -> abgleiche[0] += 1));
        assertEquals(1, abgleiche[0]);
    }

    @Test
    public void nachholpauseGiltNurFuerIhrExaktesZiel() {
        String folge5 = BASIS + "/staffel-1/episode-5";
        assertTrue(MainActivity.direktPausiertStarten(true, folge5, folge5 + "?quelle=voe"));
        assertFalse("Eine neuere Folge erbt die Pause des verworfenen Nachholers",
            MainActivity.direktPausiertStarten(true, folge5,
                BASIS + "/staffel-1/episode-6"));
        assertTrue("Der vorhandene Queue-Rueckweg bleibt ein einmaliger Pausenstart",
            MainActivity.direktPausiertStarten(true, "",
                BASIS + "/staffel-1/episode-4"));
        assertFalse(MainActivity.direktPausiertStarten(false, folge5, folge5));
    }

    /**
     * Android bildet den Titelschluessel nicht mehr selbst.
     *
     * <p>Es tat es, und zwar unvertraeglich: aus der Serienadresse, waehrend
     * der Rechner ihn aus Art und Titel bildet ("serie:bleach"). Dieselbe
     * Runde, derselbe Anime, zwei Schluessel - und alles, was am Schluessel
     * haengt, fand einander nie: die Mitgliedschaft im Titel, die
     * Standmeldung, jeder Steuerbefehl, die Hostwahl. Ein Telefon tauchte am
     * Rechner weder als Mitschauer noch als Host auf, und seine Pause ging
     * nirgendwo hin.
     *
     * <p>Jetzt fragt {@link Mitschauen} den Kern
     * ({@code watchparty-bruecke.lageFuer}). Diese Pruefung haelt fest, dass
     * hier keine zweite Bildung zurueckkommt - der Vergleich beider Fassungen
     * steht in {@code tests/androidwatchpartytest.js} und laeuft dort an einem
     * echten Relay gegen die Watchparty des Rechners.
     */
    @Test
    public void bildetDenTitelschluesselNichtMehrSelbst() {
        for (java.lang.reflect.Method methode : Mitschauen.class.getDeclaredMethods()) {
            assertFalse("Mitschauen darf den Titelschluessel nicht selbst bilden: "
                    + methode.getName(),
                methode.getName().toLowerCase().startsWith("schluesselfuer"));
        }
    }

    /*
     * Gemeldet aus einer laufenden Runde: als Gast liess sich das Intro nicht
     * ueberspringen, "ich werd einfach zurueckgesetzt". Der Player sprang
     * oertlich, die Meldung verliess das Geraet aber nie - dieses Schema
     * kannte "skip" nicht und verwarf sie. Danach holte der naechste Abgleich
     * den Gast an die Stelle der Runde zurueck.
     */
    @Test
    public void laesstDasUeberspringenHinaus() {
        assertTrue("Ohne \"skip\" verlaesst das Ueberspringen das Geraet nie",
            Mitschauen.TATEN.contains("skip"));
        for (String tat : new String[]{"play", "pause", "seek"}) {
            assertTrue("Eine bekannte Tat fiel heraus: " + tat, Mitschauen.TATEN.contains(tat));
        }
        assertEquals("Es sind mehr Taten erlaubt als gedacht", 4, Mitschauen.TATEN.size());
        assertFalse("Beliebiger Text darf nicht als Tat durchgehen",
            Mitschauen.TATEN.contains("navigate"));
    }

    @Test
    public void erkenntStaffelUndFolge() {
        assertArrayEquals(new int[]{3, 8},
            Mitschauen.folgeAus(BASIS + "/staffel-3/episode-8"));
        // Die deutschen Schreibweisen ebenso - s.to benutzt sie.
        assertArrayEquals(new int[]{1, 5},
            Mitschauen.folgeAus("https://s.to/serie/stream/test/staffel-1/folge-5"));
        // Ein Film hat keine Folge; die Null ist die Antwort und kein Fehler.
        assertArrayEquals(new int[]{0, 0},
            Mitschauen.folgeAus("https://filmo.to/film/irgendwas"));
        assertArrayEquals(new int[]{0, 0}, Mitschauen.folgeAus(null));
    }

    @Test
    public void dieselbeFolgeBleibtDieselbe() {
        String eine = BASIS + "/staffel-3/episode-8";
        assertTrue(Mitschauen.gleicheFolge(eine, eine));
        // Ein angehaengter Hoster oder eine Sprache macht keine neue Folge:
        // genau daran ist der Vergleich Zeichen fuer Zeichen gescheitert.
        assertTrue(Mitschauen.gleicheFolge(eine, eine + "?hoster=voe"));
        assertTrue(Mitschauen.gleicheFolge(eine, eine + "#sprache-2"));
        assertTrue(Mitschauen.gleicheFolge(eine, eine + "/"));
        // Und www. oder http statt https ebensowenig.
        assertTrue(Mitschauen.gleicheFolge(eine,
            "http://www.aniworld.to/anime/stream/naruto/staffel-3/episode-8"));
    }

    @Test
    public void andereFolgeIstEineAndere() {
        String eine = BASIS + "/staffel-3/episode-8";
        assertFalse(Mitschauen.gleicheFolge(eine, BASIS + "/staffel-3/episode-9"));
        assertFalse(Mitschauen.gleicheFolge(eine, BASIS + "/staffel-4/episode-8"));
        assertFalse(Mitschauen.gleicheFolge(eine,
            "https://aniworld.to/anime/stream/bleach/staffel-3/episode-8"));
        // Und ein anderer Anbieter ist nie dieselbe Folge, auch bei gleichem
        // Titel und gleicher Nummer.
        assertFalse(Mitschauen.gleicheFolge(eine,
            "https://s.to/serie/stream/naruto/staffel-3/episode-8"));
    }

    @Test
    public void leereAngabenSindNieDieselbeFolge() {
        assertFalse(Mitschauen.gleicheFolge(null, BASIS + "/staffel-1/episode-1"));
        assertFalse(Mitschauen.gleicheFolge(BASIS + "/staffel-1/episode-1", ""));
        assertFalse(Mitschauen.gleicheFolge(null, null));
    }

    @Test
    public void derSerienteilLaesstFolgeUndBeiwerkWeg() {
        assertEquals("aniworld.to/anime/stream/naruto",
            Mitschauen.serienTeil(BASIS + "/staffel-3/episode-8?hoster=voe"));
        assertEquals("aniworld.to/anime/stream/naruto", Mitschauen.serienTeil(BASIS + "/"));
        assertEquals("", Mitschauen.serienTeil(null));
    }
}
