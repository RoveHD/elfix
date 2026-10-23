package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Guardrails for the passive, MAL-bounded intro episode lookup. */
public class DirektWiedergabeIntroTest {

    @Test
    public void liestNurAnimeMitMALGesamtzahlAbStaffelZweiNach() throws Exception {
        JSONObject kontext = new JSONObject("{\"art\":\"anime\",\"ids\":{\"mal\":34572},"
            + "\"season\":2,\"episode\":20,\"malFolgenGesamt\":170}");
        assertTrue(DirektWiedergabe.introStaffelnNoetig(kontext));
        assertFalse(DirektWiedergabe.introStaffelnNoetig(new JSONObject(
            "{\"art\":\"anime\",\"ids\":{\"mal\":34572},\"season\":1,\"malFolgenGesamt\":170}")));
        assertFalse(DirektWiedergabe.introStaffelnNoetig(new JSONObject(
            "{\"art\":\"anime\",\"ids\":{\"mal\":34572},\"season\":2,\"malFolgenGesamt\":170,\"malEpisode\":71}")));
        assertFalse(DirektWiedergabe.introStaffelnNoetig(new JSONObject(
            "{\"art\":\"serie\",\"ids\":{\"mal\":34572},\"season\":2,\"malFolgenGesamt\":170}")));
    }

    @Test
    public void staffelUrlMussZurGleichenSerieUndNummerGehoren() throws Exception {
        JSONArray staffeln = new JSONArray("[{\"staffel\":1,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-1\"},"
            + "{\"staffel\":2,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-2\"},"
            + "{\"staffel\":3,\"url\":\"https://aniworld.to/anime/stream/anderer-titel/staffel-3\"},"
            + "{\"staffel\":0,\"url\":\"https://aniworld.to/anime/stream/black-clover/filme\"}]");
        String episode = "https://aniworld.to/anime/stream/black-clover/staffel-2/episode-20";
        assertEquals("https://aniworld.to/anime/stream/black-clover/staffel-2",
            DirektWiedergabe.introStaffelUrl(staffeln, 2, episode));
        assertEquals("", DirektWiedergabe.introStaffelUrl(staffeln, 3, episode));
        assertEquals("", DirektWiedergabe.introStaffelUrl(staffeln, 0, episode));
    }

    @Test
    public void stopptBeimGesamtumfangOhneSpaetereCouriStaffelnZuLesen() {
        int summe = 0;
        int[] folgen = { 51, 51, 52, 16, 12 };
        int geleseneStaffeln = 0;
        for (int anzahl : folgen) {
            if (!DirektWiedergabe.introWeitereStaffelNoetig(summe, 170)) break;
            summe += anzahl;
            geleseneStaffeln++;
        }
        assertEquals(170, summe);
        assertEquals(4, geleseneStaffeln);
        assertFalse(DirektWiedergabe.introWeitereStaffelNoetig(summe, 170));
        assertTrue(DirektWiedergabe.introWeitereStaffelNoetig(154, 170));
        assertFalse(DirektWiedergabe.introWeitereStaffelNoetig(206, 170));
    }

    @Test
    public void normalerErwarteterInhaltIstKeineChallenge() throws Exception {
        assertFalse(DirektWiedergabe.introGateBlockiert(
            new JSONObject("{\"offen\":false,\"erwartet\":true}")));
        assertTrue(DirektWiedergabe.introGateBlockiert(
            new JSONObject("{\"offen\":true,\"erwartet\":false}")));
        assertTrue(DirektWiedergabe.introGateBlockiert(null));
    }

    @Test
    public void sammlerLiestNurBisZurBelegtenMalGrenze() throws Exception {
        JSONArray staffeln = staffeln();
        java.util.List<Integer> angefragt = new java.util.ArrayList<>();
        final JSONArray[] ergebnis = { null };
        DirektWiedergabe.IntroStaffelSammler sammler = new DirektWiedergabe.IntroStaffelSammler(
            staffeln, "https://aniworld.to/anime/stream/black-clover/staffel-2/episode-20",
            170, new java.util.HashMap<>(), (nummer, url, fertig) -> {
                angefragt.add(nummer);
                fertig.accept(stand(nummer, new int[] { 51, 51, 52, 16, 12 }[nummer - 1]));
            }, () -> true, listen -> ergebnis[0] = listen);

        sammler.starten();

        assertEquals(java.util.Arrays.asList(1, 2, 3, 4), angefragt);
        assertEquals(4, ergebnis[0].length());
    }

    @Test
    public void challengeOderFehlerBrichtOhneSpaetereStaffelnAb() throws Exception {
        JSONArray staffeln = staffeln();
        java.util.List<Integer> angefragt = new java.util.ArrayList<>();
        final JSONArray[] ergebnis = { new JSONArray() };
        DirektWiedergabe.IntroStaffelSammler sammler = new DirektWiedergabe.IntroStaffelSammler(
            staffeln, "https://aniworld.to/anime/stream/black-clover/staffel-2/episode-20",
            170, new java.util.HashMap<>(), (nummer, url, fertig) -> {
                angefragt.add(nummer);
                if (nummer == 3) fertig.accept(null); // Der passive Leser erkennt eine Challenge.
                else fertig.accept(stand(nummer, 51));
            }, () -> true, listen -> ergebnis[0] = listen);

        sammler.starten();

        assertEquals(java.util.Arrays.asList(1, 2, 3), angefragt);
        assertEquals(null, ergebnis[0]);
    }

    @Test
    public void spaeteDoppelteAntwortKannNichtDieFolgestaffelVerschieben() throws Exception {
        JSONArray staffeln = staffeln();
        java.util.List<Integer> angefragt = new java.util.ArrayList<>();
        final java.util.function.Consumer<JSONObject>[] alteAntwort = new java.util.function.Consumer[1];
        final JSONArray[] ergebnis = { null };
        DirektWiedergabe.IntroStaffelSammler sammler = new DirektWiedergabe.IntroStaffelSammler(
            staffeln, "https://aniworld.to/anime/stream/black-clover/staffel-2/episode-20",
            170, new java.util.HashMap<>(), (nummer, url, fertig) -> {
                angefragt.add(nummer);
                if (nummer == 1) alteAntwort[0] = fertig;
                else fertig.accept(stand(nummer, 119));
            }, () -> true, listen -> ergebnis[0] = listen);

        sammler.starten();
        alteAntwort[0].accept(stand(1, 51));
        alteAntwort[0].accept(stand(1, 51));

        assertEquals(java.util.Arrays.asList(1, 2), angefragt);
        assertEquals(2, ergebnis[0].length());
    }

    @Test
    public void staffelUeberMalGrenzeBrichtOhneTeillistenErfolgAb() throws Exception {
        JSONArray staffeln = staffeln();
        java.util.List<Integer> angefragt = new java.util.ArrayList<>();
        final JSONArray[] ergebnis = { null };
        DirektWiedergabe.IntroStaffelSammler sammler = new DirektWiedergabe.IntroStaffelSammler(
            staffeln, "https://aniworld.to/anime/stream/black-clover/staffel-2/episode-20",
            170, new java.util.HashMap<>(), (nummer, url, fertig) -> {
                angefragt.add(nummer);
                fertig.accept(stand(nummer, nummer == 1 ? 51 : 120));
            }, () -> true, listen -> ergebnis[0] = listen);

        sammler.starten();

        assertEquals(java.util.Arrays.asList(1, 2), angefragt);
        assertEquals(null, ergebnis[0]);
    }

    @Test
    public void ersetzteAnfrageDarfWederCacheNochNachfolgerVeraendern() throws Exception {
        final boolean[] gueltig = { true };
        final int[] abschluesse = { 0 };
        final java.util.function.Consumer<JSONObject>[] alteAntwort = new java.util.function.Consumer[1];
        java.util.Map<Integer, JSONObject> cache = new java.util.HashMap<>();
        java.util.List<Integer> angefragt = new java.util.ArrayList<>();
        DirektWiedergabe.IntroStaffelSammler sammler = new DirektWiedergabe.IntroStaffelSammler(
            staffeln(), "https://aniworld.to/anime/stream/black-clover/staffel-2/episode-20",
            170, cache, (nummer, url, fertig) -> {
                angefragt.add(nummer);
                alteAntwort[0] = fertig;
            }, () -> gueltig[0], listen -> abschluesse[0]++);
        sammler.starten();
        gueltig[0] = false;
        alteAntwort[0].accept(stand(1, 51));
        assertEquals(java.util.Arrays.asList(1), angefragt);
        assertTrue(cache.isEmpty());
        assertEquals(0, abschluesse[0]);
    }

    private static JSONArray staffeln() throws Exception {
        return new JSONArray("[{\"staffel\":1,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-1\"},"
            + "{\"staffel\":2,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-2\"},"
            + "{\"staffel\":3,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-3\"},"
            + "{\"staffel\":4,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-4\"},"
            + "{\"staffel\":5,\"url\":\"https://aniworld.to/anime/stream/black-clover/staffel-5\"}]");
    }

    private static JSONObject stand(int nummer, int anzahl) {
        try {
            JSONArray folgen = new JSONArray();
            for (int i = 1; i <= anzahl; i++) folgen.put(new JSONObject().put("folge", i));
            return new JSONObject().put("offeneStaffel", nummer).put("folgen", folgen);
        } catch (org.json.JSONException fehler) {
            throw new AssertionError(fehler);
        }
    }
}
