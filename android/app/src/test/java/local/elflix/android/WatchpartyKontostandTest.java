package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/** Die verlustfreie v2-Vereinigung der Watchparty-Mitgliedschaften. */
public final class WatchpartyKontostandTest {
    private static final String ROOM = "ABCD-1234";

    private static long zeit(int versatz) {
        return System.currentTimeMillis() - 60_000 + versatz;
    }

    private static JSONObject standMitFuenf() throws Exception {
        JSONArray joined = new JSONArray();
        for (int i = 1; i <= 5; i += 1) {
            joined.put(new JSONObject().put("room", ROOM).put("key", "serie-" + i)
                .put("at", zeit(i)));
        }
        return new JSONObject().put("version", 2)
            .put("rooms", new JSONArray().put(ROOM)).put("joined", joined);
    }

    @Test
    public void alterLeerschnappschussLoeschtKeineFuenfBeitritte() throws Exception {
        JSONObject altLeer = new JSONObject()
            .put("rooms", new JSONArray()).put("joined", new JSONArray());

        JSONObject vereinigt = Watchparty.kontoStaendeVereinen(standMitFuenf(), altLeer);

        assertEquals(1, vereinigt.getJSONArray("rooms").length());
        assertEquals(5, vereinigt.getJSONArray("joined").length());
        assertEquals(0, vereinigt.getJSONArray("left").length());
    }

    @Test
    public void ausdruecklichesLeaveGewinntAuchBeiGleicherZeit() throws Exception {
        long at = zeit(100);
        JSONObject join = new JSONObject().put("rooms", new JSONArray().put(ROOM))
            .put("joined", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("key", "serie").put("at", at)));
        JSONObject leave = new JSONObject().put("left", new JSONArray().put(new JSONObject()
            .put("room", ROOM).put("key", "serie").put("at", at)));

        JSONObject vereinigt = Watchparty.kontoStaendeVereinen(join, leave);

        assertEquals(0, vereinigt.getJSONArray("joined").length());
        assertEquals(1, vereinigt.getJSONArray("left").length());
        assertEquals(at, vereinigt.getJSONArray("left").getJSONObject(0).getLong("at"));
    }

    @Test
    public void alterLegacyJoinKannTombstoneNichtWiederbeleben() throws Exception {
        long at = zeit(200);
        JSONObject tombstone = new JSONObject().put("rooms", new JSONArray().put(ROOM))
            .put("left", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("key", "serie").put("at", at)));
        JSONObject legacy = new JSONObject().put("rooms", new JSONArray().put(ROOM))
            .put("joined", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("key", "serie")));

        JSONObject vereinigt = Watchparty.kontoStaendeVereinen(tombstone, legacy);

        assertEquals(0, vereinigt.getJSONArray("joined").length());
        assertEquals(1, vereinigt.getJSONArray("left").length());
    }

    @Test
    public void neuerLokalerRejoinIstJuengerAlsBekanntesLeave() throws Exception {
        long leaveAt = zeit(300);
        JSONObject stand = new JSONObject().put("rooms", new JSONArray().put(ROOM))
            .put("left", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("key", "serie").put("at", leaveAt)));

        JSONObject wiederDabei = Watchparty.mitgliedschaftLokalSetzen(
            stand, "serie", ROOM, true, leaveAt);

        assertEquals(1, wiederDabei.getJSONArray("joined").length());
        assertEquals(leaveAt + 1,
            wiederDabei.getJSONArray("joined").getJSONObject(0).getLong("at"));
        assertEquals(0, wiederDabei.getJSONArray("left").length());
    }

    @Test
    public void tombstonesUeberlebenDenSpeicherRundlauf() throws Exception {
        long at = zeit(400);
        JSONObject stand = new JSONObject().put("version", 2)
            .put("rooms", new JSONArray())
            .put("roomOps", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("present", false).put("at", at)))
            .put("left", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("key", "serie").put("at", at)));

        String gespeichert = Watchparty.kontoStandFuerSpeicher(stand);
        JSONObject neuGeladen = Watchparty.kontoStandAusSpeicher(gespeichert);

        assertEquals(gespeichert, Watchparty.kontoStandFuerSpeicher(neuGeladen));
        assertFalse(neuGeladen.getJSONArray("roomOps").getJSONObject(0)
            .getBoolean("present"));
        assertEquals(1, neuGeladen.getJSONArray("left").length());
    }

    @Test
    public void raumRemoveBlockiertAlteJoinsAuchNachReadd() throws Exception {
        long joinAt = zeit(500);
        JSONObject stand = new JSONObject().put("rooms", new JSONArray().put(ROOM))
            .put("joined", new JSONArray().put(new JSONObject()
                .put("room", ROOM).put("key", "serie").put("at", joinAt)));

        JSONObject entfernt = Watchparty.raumLokalSetzen(stand, ROOM, false, joinAt + 10);
        assertEquals(0, entfernt.getJSONArray("rooms").length());
        assertEquals(0, entfernt.getJSONArray("joined").length());
        assertEquals(joinAt + 10,
            entfernt.getJSONArray("left").getJSONObject(0).getLong("at"));

        JSONObject wiederDa = Watchparty.raumLokalSetzen(entfernt, ROOM, true, joinAt + 10);
        assertEquals(1, wiederDa.getJSONArray("rooms").length());
        assertEquals(0, wiederDa.getJSONArray("joined").length());
        assertTrue(wiederDa.getJSONArray("roomOps").getJSONObject(0).getBoolean("present"));
        assertEquals(joinAt + 11,
            wiederDa.getJSONArray("roomOps").getJSONObject(0).getLong("at"));
    }
}
