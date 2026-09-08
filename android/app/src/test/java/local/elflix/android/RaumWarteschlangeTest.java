package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

public class RaumWarteschlangeTest {
    private static final class Aufruf {
        final String pfad;
        final JSONArray args;
        Aufruf(String pfad, JSONArray args) { this.pfad = pfad; this.args = args; }
    }

    private static final class FakeRufer implements RaumWarteschlange.Rufer {
        boolean bereit = true;
        final List<Aufruf> aufrufe = new ArrayList<>();
        @Override public boolean bereit() { return bereit; }
        @Override public void rufe(String pfad, JSONArray args) { aufrufe.add(new Aufruf(pfad, args)); }
    }

    private static final class FakeStarter implements RaumWarteschlange.Starter {
        int starts;
        int cancels;
        boolean manuell;
        Consumer<Boolean> fertig;
        @Override public void starten(boolean yt, JSONObject auftrag, boolean manuell,
                                      Consumer<Boolean> fertig) {
            starts += 1;
            this.manuell = manuell;
            this.fertig = fertig;
        }
        @Override public void abbrechen(boolean yt, JSONObject auftrag) { cancels += 1; }
    }

    @Test public void haeltStaendeGetrenntUndStartUeberschreibtSieNicht() throws Exception {
        FakeRufer rufer = new FakeRufer();
        FakeStarter starter = new FakeStarter();
        RaumWarteschlange queue = new RaumWarteschlange(rufer, null, starter, () -> 1000);
        queue.ereignis("queue:state", new JSONObject().put("room", "A").put("rev", 3)
            .put("items", new JSONArray().put(new JSONObject().put("id", "a"))).toString());
        queue.ereignis("queue:state", new JSONObject().put("room", "B").put("rev", 8).toString());
        queue.ereignis("queue:start", start("A", "s1", "entry", "old").toString());
        assertEquals(3, queue.stand(false, "A").getInt("rev"));
        assertEquals(8, queue.stand(false, "B").getInt("rev"));
        assertEquals("a", queue.eintraege(false, "A").getJSONObject(0).getString("id"));
        assertEquals(1, starter.starts);
    }

    @Test public void gleicherStartIstWaehrenLadenUndNachAntwortIdempotent() throws Exception {
        FakeRufer rufer = new FakeRufer();
        FakeStarter starter = new FakeStarter();
        RaumWarteschlange queue = new RaumWarteschlange(rufer, null, starter, () -> 1000);
        String json = start("A", "s1", "entry", "old").toString();
        queue.ereignis("queue:start", json);
        queue.ereignis("queue:start", json);
        assertEquals(1, starter.starts);
        assertEquals(0, rufer.aufrufe.size());
        starter.fertig.accept(true);
        queue.ereignis("queue:start", json);
        assertEquals(1, starter.starts);
        assertEquals(2, rufer.aufrufe.size());
        assertEquals("watchparty-bruecke.queueStarted", rufer.aufrufe.get(0).pfad);
        assertEquals("s1", rufer.aufrufe.get(0).args.getString(0));
        assertTrue(rufer.aufrufe.get(0).args.getBoolean(1));
        assertEquals("A", rufer.aufrufe.get(0).args.getString(2));
    }

    @Test public void manuelleFreigabeIstAnAuswahlUndQuelleGebunden() throws Exception {
        FakeRufer rufer = new FakeRufer();
        FakeStarter starter = new FakeStarter();
        RaumWarteschlange queue = new RaumWarteschlange(rufer, null, starter, () -> 1000);
        assertTrue(queue.weiter(false, "A", "entry", "old", true));
        queue.ereignis("queue:start", start("A", "s1", "andere", "old").toString());
        assertFalse(starter.manuell);
        starter.fertig.accept(false);
        queue.ereignis("queue:start", start("A", "s2", "entry", "old").toString());
        assertFalse(starter.manuell);

        assertTrue(queue.weiter(false, "A", "entry", "old", true));
        queue.ereignis("queue:start", start("A", "s3", "entry", "old").toString());
        assertTrue(starter.manuell);
    }

    @Test public void abgelaufenerStartWirdSofortAbgelehntUndCancelWeitergegeben() throws Exception {
        FakeRufer rufer = new FakeRufer();
        FakeStarter starter = new FakeStarter();
        RaumWarteschlange queue = new RaumWarteschlange(rufer, null, starter, () -> 2000);
        JSONObject abgelaufen = start("A", "s1", "entry", "old").put("expiresAt", 1999);
        queue.ereignis("queue:start", abgelaufen.toString());
        assertEquals(0, starter.starts);
        assertFalse(rufer.aufrufe.get(0).args.getBoolean(1));
        queue.ereignis("queue:cancel", new JSONObject().put("room", "A")
            .put("startId", "s1").toString());
        assertEquals(1, starter.cancels);
    }

    @Test public void echtesEndeStartetNurAuswahlUndPendingBlockiertFolge() throws Exception {
        FakeRufer rufer = new FakeRufer();
        RaumWarteschlange queue = new RaumWarteschlange(rufer, null, null, () -> 1000);
        queue.ereignis("queue:state", new JSONObject().put("room", "A")
            .put("selectedId", "entry").toString());
        assertTrue(queue.automatischWeiter("A", "old"));
        assertEquals("watchparty-bruecke.queueAdvance", rufer.aufrufe.get(0).pfad);
        queue.ereignis("queue:state", new JSONObject().put("room", "A")
            .put("selectedId", "").put("pending", new JSONObject().put("startId", "s"))
            .toString());
        assertTrue(queue.automatischWeiter("A", "old"));
        assertEquals(1, rufer.aufrufe.size());
        assertFalse(queue.automatischWeiter("B", "old"));
    }

    private static JSONObject start(String room, String startId, String id, String from)
        throws Exception {
        return new JSONObject().put("room", room).put("startId", startId)
            .put("item", new JSONObject().put("id", id).put("key", id))
            .put("fromKey", from).put("expiresAt", 5000);
    }
}
