package local.elflix.android;

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
}
