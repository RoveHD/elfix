package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Covers the display rule without an Android UI or relay connection. */
public class SpoilerSchutzTest {
    private static Favorite favorite(JSONArray completed, int currentEpisode) throws Exception {
        return new Favorite(new JSONObject()
            .put("season", 1)
            .put("episode", currentEpisode)
            .put("currentTime", 1300)
            .put("completedEpisodes", completed)
            .put("watchpartyRoom", "abend"));
    }

    @Test public void onlyExplicitCompletionMakesPersonalEpisodeVisible() throws Exception {
        Favorite favorite = favorite(new JSONArray().put(new JSONObject()
            .put("season", 1).put("episode", 2)), 9);
        SpoilerSchutz.Einstellung setting = new SpoilerSchutz.Einstellung(true, false, false);
        assertTrue(SpoilerSchutz.sichtbar(setting, favorite, 1, 2, null));
        assertFalse("Current playback episode is not proof of watching",
            SpoilerSchutz.sichtbar(setting, favorite, 1, 9, null));
        assertFalse(SpoilerSchutz.sichtbar(setting, favorite, 1, 3, null));
    }

    @Test public void roomMinimumRequiresKnownAggregateCompletion() throws Exception {
        Favorite favorite = favorite(new JSONArray().put(new JSONArray().put(1).put(2)), 2);
        SpoilerSchutz.Einstellung setting = new SpoilerSchutz.Einstellung(true, true, false);
        assertFalse("Missing room state is unknown and must mask",
            SpoilerSchutz.sichtbar(setting, favorite, 1, 2, null));
        assertFalse(SpoilerSchutz.sichtbar(setting, favorite, 1, 2,
            new SpoilerSchutz.Raumstand(false, new JSONArray().put(new JSONArray().put(1).put(2)))));
        assertTrue(SpoilerSchutz.sichtbar(setting, favorite, 1, 2,
            new SpoilerSchutz.Raumstand(true, new JSONArray().put(new JSONArray().put(1).put(2)))));
    }

    @Test public void disabledProtectionDoesNotHideAnything() throws Exception {
        assertTrue(SpoilerSchutz.sichtbar(new SpoilerSchutz.Einstellung(false, true, false),
            favorite(new JSONArray(), 0), 3, 8, null));
    }

    @Test public void localRoomCopyUsesPersonalExplicitCompletions() throws Exception {
        Favorite raum = favorite(new JSONArray(), 9);
        JSONArray completed = new JSONArray().put(new JSONArray().put(1).put(2));
        SpoilerSchutz.Einstellung setting = new SpoilerSchutz.Einstellung(true, false, false);
        assertTrue(SpoilerSchutz.sichtbar(setting, raum, completed, 1, 2, null));
        assertFalse(SpoilerSchutz.sichtbar(setting, raum, completed, 1, 9, null));
    }

    @Test public void unionsOnlyExactCompletedEpisodesOfSameSeries() throws Exception {
        Favorite privat = new Favorite(new JSONObject().put("url", "https://x/serie/stream/test/staffel-1/episode-1")
            .put("completedEpisodes", new JSONArray().put(new JSONArray().put(1).put(2))));
        Favorite raum = new Favorite(new JSONObject().put("url", "https://x/serie/stream/test/staffel-2/episode-1")
            .put("completedEpisodes", new JSONArray().put(new JSONArray().put(2).put(3.5))));
        Favorite andere = new Favorite(new JSONObject().put("url", "https://x/serie/stream/andere/staffel-1/episode-2")
            .put("completedEpisodes", new JSONArray().put(new JSONArray().put(1).put(9))));
        JSONArray komplett = SpoilerSchutz.abgeschlosseneFolgen(java.util.Arrays.asList(privat, raum, andere), raum);
        assertTrue(SpoilerSchutz.enthaelt(komplett, 1, 2));
        assertFalse("fractional ids must not be truncated into seen", SpoilerSchutz.enthaelt(komplett, 2, 3));
        assertFalse(SpoilerSchutz.enthaelt(komplett, 1, 9));
    }

    /*
     * Verlaufslabels belegen weder die 90-%-Regel noch die Mindestsehzeit.
     */
    @Test public void historyLabelsNeverReplaceVerifiedCompletion() throws Exception {
        JSONArray verlauf = new JSONArray()
            .put(new JSONObject().put("url", "https://x/serie/stream/test/staffel-3/episode-17")
                .put("label", "Abgeschlossen"))
            .put(new JSONObject().put("url", "https://x/serie/stream/test/staffel-3/episode-18")
                .put("label", "Geöffnet"))
            .put(new JSONObject().put("url", "https://x/serie/stream/test/staffel-3/episode-19")
                .put("label", "Staffel 3 Folge 19"))
            .put(new JSONObject().put("label", "ohne Folge"));
        Favorite eintrag = new Favorite(new JSONObject()
            .put("url", "https://x/serie/stream/test/staffel-3/episode-22")
            .put("completedEpisodes", new JSONArray().put(new JSONArray().put(3).put(20)))
            .put("activity", verlauf));
        JSONArray komplett = SpoilerSchutz.abgeschlosseneFolgen(
            java.util.Collections.singletonList(eintrag), eintrag);
        assertTrue("der Abschluss zaehlt", SpoilerSchutz.enthaelt(komplett, 3, 20));
        assertFalse("ein rohes ended-Ereignis ist kein bestaetigter Abschluss", SpoilerSchutz.enthaelt(komplett, 3, 17));
        assertFalse("eine bloss geoeffnete Seite ist keine Wiedergabe",
            SpoilerSchutz.enthaelt(komplett, 3, 18));
        assertFalse("eine Startmeldung ist kein 90-%-Abschluss", SpoilerSchutz.enthaelt(komplett, 3, 19));
        assertEquals("nur der bestaetigte Abschluss zaehlt", 1, komplett.length());
    }

    /*
     * Ein ausdruecklich entfernter Haken ueberstimmt gespeicherte Abschluesse.
     */
    @Test public void manualUnmarkOutweighsStoredCompletion() throws Exception {
        Favorite eintrag = new Favorite(new JSONObject()
            .put("url", "https://x/serie/stream/test/staffel-3/episode-22")
            .put("completedEpisodes", new JSONArray().put(new JSONArray().put(3).put(20)))
            .put("activity", new JSONArray().put(new JSONObject()
                .put("url", "https://x/serie/stream/test/staffel-3/episode-17")
                .put("label", "Abgeschlossen")))
            .put("unwatchedEpisodes", new JSONArray()
                .put(new JSONArray().put(3).put(17))
                .put(new JSONArray().put(3).put(20))));
        JSONArray komplett = SpoilerSchutz.abgeschlosseneFolgen(
            java.util.Collections.singletonList(eintrag), eintrag);
        assertEquals(0, komplett.length());
    }

    @Test public void startingEpisodeKeepsSeenFalseAndTitleProtected() throws Exception {
        for (int progress : new int[] { 0, 1, 30, 89, 99 }) {
            Favorite eintrag = new Favorite(new JSONObject()
                .put("url", "https://x/serie/stream/test/staffel-3/episode-3")
                .put("progress", progress).put("season", 3).put("episode", 3)
                .put("activity", new JSONArray().put(new JSONObject()
                    .put("url", "https://x/serie/stream/test/staffel-3/episode-3")
                    .put("label", "Staffel 3 Folge 3"))));
            JSONArray abgeschlossen = SpoilerSchutz.abgeschlosseneFolgen(
                java.util.Collections.singletonList(eintrag), eintrag);
            assertFalse("Start/Wiedereinstieg reicht nicht; shared fortschritt muss 90 % bestaetigen",
                SpoilerSchutz.sichtbar(new SpoilerSchutz.Einstellung(true, false, false),
                    eintrag, abgeschlossen, 3, 3, null));
        }
    }
}
