package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Die gespeicherte Folge aus der Liste des nativen Android-Players. */
public class WeiterschauenFolgeTest {

    private static JSONArray folgen() throws Exception {
        return new JSONArray("["
            + "{\"staffel\":1,\"folge\":7,\"url\":\"https://aniworld.to/anime/stream/x/staffel-1/episode-7\"},"
            + "{\"staffel\":2,\"folge\":7,\"url\":\"https://aniworld.to/anime/stream/x/staffel-2/episode-7\"},"
            + "{\"staffel\":2,\"folge\":8,\"url\":\"https://aniworld.to/anime/stream/x/staffel-2/episode-8\"},"
            + "{\"staffel\":2,\"folge\":9,\"url\":\"https://aniworld.to/anime/stream/x/staffel-2/episode-9\",\"gesperrt\":true}"
            + "]");
    }

    @Test
    public void nimmtStaffelUndFolgeDesGespeichertenStands() throws Exception {
        assertEquals("https://aniworld.to/anime/stream/x/staffel-2/episode-7",
            DirektWiedergabe.gespeicherteFolgenUrl(folgen(), 2, 7));
    }

    @Test
    public void verwechseltGleicheFolgenzahlInAndererStaffelNicht() throws Exception {
        assertEquals("https://aniworld.to/anime/stream/x/staffel-1/episode-7",
            DirektWiedergabe.gespeicherteFolgenUrl(folgen(), 1, 7));
    }

    @Test
    public void fehlendeOderGesperrteFolgeFaelltAufDieAuswahlZurueck() throws Exception {
        assertEquals("", DirektWiedergabe.gespeicherteFolgenUrl(folgen(), 3, 7));
        assertEquals("", DirektWiedergabe.gespeicherteFolgenUrl(folgen(), 2, 9));
    }

    @Test
    public void praezisierteFolgenadresseBehaeltDieGespeicherteSekunde() throws Exception {
        Favorite stand = new Favorite(new JSONObject()
            .put("url", "https://aniworld.to/anime/stream/x")
            .put("season", 2)
            .put("episode", 7)
            .put("currentTime", 412));
        assertTrue(Folgen.istGespeicherteFolge(stand,
            "https://aniworld.to/anime/stream/x/staffel-2/episode-7"));
    }

    @Test
    public void gleicheNummernEinerAnderenSerieSindKeinStand() throws Exception {
        Favorite stand = new Favorite(new JSONObject()
            .put("url", "https://aniworld.to/anime/stream/x")
            .put("season", 2)
            .put("episode", 7));
        assertFalse(Folgen.istGespeicherteFolge(stand,
            "https://aniworld.to/anime/stream/y/staffel-2/episode-7"));
    }

    @Test
    public void nurPrivatesWeiterschauenWaehltAutomatisch() throws Exception {
        JSONObject roh = new JSONObject()
            .put("url", "https://aniworld.to/anime/stream/x")
            .put("season", 2)
            .put("episode", 7)
            .put("currentTime", 412)
            .put("duration", 1400);
        assertTrue(MainActivity.istEigenerFortsetzStand(new Favorite(roh)));

        JSONObject nurVorgemerkt = new JSONObject(roh.toString());
        nurVorgemerkt.remove("currentTime");
        nurVorgemerkt.remove("duration");
        assertFalse(MainActivity.istEigenerFortsetzStand(new Favorite(nurVorgemerkt)));

        JSONObject gemeinsam = new JSONObject(roh.toString()).put("watchpartyRoom", "salon");
        assertFalse(MainActivity.istEigenerFortsetzStand(new Favorite(gemeinsam)));
    }

    @Test
    public void staleSerienadresseWirdMitPassenderEpisodeGeheilt() throws Exception {
        JSONObject nachricht = new JSONObject()
            .put("url", "https://aniworld.to/anime/stream/x/staffel-2")
            .put("episodeId", "s2e7");
        assertTrue(Mitschauen.gleicheNachrichtFolge(nachricht,
            "https://aniworld.to/anime/stream/x/staffel-2/episode-7"));
    }

    @Test
    public void staleSerienadresseMitFalscherEpisodeBleibtGetrennt() throws Exception {
        JSONObject nachricht = new JSONObject()
            .put("url", "https://aniworld.to/anime/stream/x/staffel-2")
            .put("episodeId", "s2e6");
        assertFalse(Mitschauen.gleicheNachrichtFolge(nachricht,
            "https://aniworld.to/anime/stream/x/staffel-2/episode-7"));
    }

    @Test
    public void konkreteAndereEpisodenadresseWirdNichtDurchEpisodeIdGeheilt() throws Exception {
        JSONObject nachricht = new JSONObject()
            .put("url", "https://aniworld.to/anime/stream/x/staffel-2/episode-6")
            .put("episodeId", "s2e7");
        assertFalse(Mitschauen.gleicheNachrichtFolge(nachricht,
            "https://aniworld.to/anime/stream/x/staffel-2/episode-7"));
    }
}
