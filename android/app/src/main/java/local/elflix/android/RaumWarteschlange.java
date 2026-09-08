package local.elflix.android;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/** Ephemeral, relay-authoritative room queues for ordinary and YouTube playback. */
final class RaumWarteschlange {
    interface Beobachter {
        void geaendert();
        default void fehler(String text) { }
    }
    interface Starter {
        void starten(boolean youtube, JSONObject auftrag, boolean manuell,
                      Consumer<Boolean> fertig);
        default void abbrechen(boolean youtube, JSONObject auftrag) { }
    }
    interface Uhr { long jetzt(); }
    interface Rufer {
        boolean bereit();
        void rufe(String pfad, JSONArray argumente);
    }

    private static final int MAX_STARTS = 64;
    private static final long MANUELL_MS = 10_000;

    private static final class StartStand {
        boolean fertig;
        boolean ok;
    }

    private static final class ManuellerStart {
        final String expectedId;
        final String from;
        final long bis;

        ManuellerStart(String expectedId, String from, long bis) {
            this.expectedId = expectedId;
            this.from = from;
            this.bis = bis;
        }
    }

    private final Rufer rufer;
    private final Beobachter beobachter;
    private final Starter starter;
    private final Uhr uhr;
    private final Map<String, JSONObject> normal = new LinkedHashMap<>();
    private final Map<String, JSONObject> youtube = new LinkedHashMap<>();
    private final Map<String, StartStand> starts = new LinkedHashMap<>();
    private final Map<String, ManuellerStart> manuell = new LinkedHashMap<>();
    private String youtubeRaum = "";

    RaumWarteschlange(Kern kern, Beobachter beobachter, Starter starter) {
        this(new Rufer() {
            @Override public boolean bereit() { return kern != null && kern.istBereit(); }
            @Override public void rufe(String pfad, JSONArray argumente) {
                kern.rufe(pfad, argumente, (wert, fehler) -> {
                    if (beobachter != null && (fehler != null || "false".equals(wert))) {
                        beobachter.fehler("Warteschlange derzeit nicht erreichbar");
                    }
                });
            }
        }, beobachter, starter, System::currentTimeMillis);
    }

    RaumWarteschlange(Rufer rufer, Beobachter beobachter, Starter starter, Uhr uhr) {
        this.rufer = rufer;
        this.beobachter = beobachter;
        this.starter = starter;
        this.uhr = uhr == null ? System::currentTimeMillis : uhr;
    }

    JSONObject stand(boolean yt, String room) {
        JSONObject wert = (yt ? youtube : normal).get(sauber(room));
        return wert == null ? new JSONObject() : wert;
    }

    JSONArray eintraege(boolean yt, String room) {
        JSONArray a = stand(yt, room).optJSONArray("items");
        return a == null ? new JSONArray() : a;
    }

    void ereignis(String name, String json) {
        boolean yt = name != null && name.startsWith("ytqueue:");
        if (!("queue:state".equals(name) || "queue:start".equals(name)
            || "queue:cancel".equals(name) || "ytqueue:state".equals(name)
            || "ytqueue:start".equals(name) || "ytqueue:cancel".equals(name))) return;
        final JSONObject wert;
        try { wert = new JSONObject(json == null ? "{}" : json); }
        catch (Exception ignored) { return; }
        String room = sauber(wert.optString("room", ""));
        if (room.isEmpty()) return;
        if (name.endsWith(":state")) {
            (yt ? youtube : normal).put(room, wert);
            if (beobachter != null) beobachter.geaendert();
            return;
        }
        if (name.endsWith(":cancel")) {
            if (starter != null) starter.abbrechen(yt, wert);
            return;
        }
        start(yt, room, wert);
    }

    private void start(boolean yt, String room, JSONObject auftrag) {
        String startId = sauber(auftrag.optString("startId", ""));
        if (startId.isEmpty()) return;
        String token = marke(yt, room) + "|" + startId;
        StartStand bekannt = starts.get(token);
        if (bekannt != null) {
            if (bekannt.fertig) gestartet(yt, room, startId, bekannt.ok);
            return;
        }
        StartStand neu = new StartStand();
        starts.put(token, neu);
        kuerzen(starts, MAX_STARTS);
        long jetzt = uhr.jetzt();
        long expiresAt = auftrag.optLong("expiresAt", 0);
        if (expiresAt > 0 && expiresAt <= jetzt) {
            abschliessen(yt, room, startId, neu, false);
            return;
        }
        ManuellerStart erlaubt = manuell.remove(marke(yt, room));
        JSONObject item = auftrag.optJSONObject("item");
        String expectedId = item == null ? "" : sauber(item.optString("id", ""));
        String from = sauber(auftrag.optString(yt ? "fromVideoId" : "fromKey", ""));
        boolean manuell = erlaubt != null && erlaubt.bis >= jetzt
            && erlaubt.expectedId.equals(expectedId) && erlaubt.from.equals(from);
        if (starter == null) {
            abschliessen(yt, room, startId, neu, false);
            return;
        }
        starter.starten(yt, auftrag, manuell,
            ok -> abschliessen(yt, room, startId, neu, Boolean.TRUE.equals(ok)));
    }

    private void abschliessen(boolean yt, String room, String startId,
                              StartStand stand, boolean ok) {
        if (stand.fertig) return;
        stand.fertig = true;
        stand.ok = ok;
        gestartet(yt, room, startId, ok);
    }

    boolean vorschlagen(boolean yt, String room, JSONObject item) {
        return rufe(yt, "Propose", item == null ? new JSONObject() : item, sauber(room));
    }

    boolean stimmen(boolean yt, String room, String id, boolean value) {
        return rufe(yt, "Vote", sauber(id), value, sauber(room));
    }

    boolean entfernen(boolean yt, String room, String id) {
        return rufe(yt, "Remove", sauber(id), sauber(room));
    }

    boolean weiter(boolean yt, String room, String expectedId, String from, boolean manuell) {
        String code = sauber(room);
        String auswahl = sauber(expectedId);
        String quelle = sauber(from);
        if (code.isEmpty() || auswahl.isEmpty()) return false;
        String marke = marke(yt, code);
        if (manuell) this.manuell.put(marke,
            new ManuellerStart(auswahl, quelle, uhr.jetzt() + MANUELL_MS));
        boolean gesendet = rufe(yt, "Advance", auswahl, quelle, code);
        if (!gesendet && manuell) this.manuell.remove(marke);
        return gesendet;
    }

    boolean automatischWeiter(String room, String fromKey) {
        JSONObject wert = stand(false, room);
        JSONObject pending = wert.optJSONObject("pending");
        if (pending != null && pending.length() > 0) return true;
        String selected = sauber(wert.optString("selectedId", ""));
        return !selected.isEmpty() && !sauber(fromKey).isEmpty()
            && weiter(false, room, selected, fromKey, false);
    }

    boolean youtubeBeitreten(String room) {
        String code = sauber(room);
        if (code.isEmpty()) return false;
        boolean gesendet = rufePfad("youtubeBeitreten", Kern.args(code));
        if (gesendet) youtubeRaum = code;
        return gesendet;
    }

    boolean youtubeVerlassen(String room) {
        String code = sauber(room);
        if (code.isEmpty()) return false;
        boolean gesendet = rufePfad("youtubeVerlassen", Kern.args(code));
        if (gesendet && code.equals(youtubeRaum)) youtubeRaum = "";
        return gesendet;
    }

    boolean youtubeRaumAktiv(String room) { return sauber(room).equals(youtubeRaum); }

    private void gestartet(boolean yt, String room, String startId, boolean ok) {
        rufe(yt, "Started", sauber(startId), ok, sauber(room));
    }

    private boolean rufe(boolean yt, String suffix, Object... args) {
        return rufePfad((yt ? "ytqueue" : "queue") + suffix, Kern.args(args));
    }

    private boolean rufePfad(String methode, JSONArray args) {
        if (rufer == null || !rufer.bereit()) return false;
        rufer.rufe("watchparty-bruecke." + methode, args);
        return true;
    }

    private static String marke(boolean yt, String room) {
        return (yt ? "youtube|" : "normal|") + sauber(room);
    }

    private static String sauber(String wert) { return wert == null ? "" : wert.trim(); }

    private static <K, V> void kuerzen(Map<K, V> map, int max) {
        while (map.size() > max) map.remove(map.keySet().iterator().next());
    }
}
