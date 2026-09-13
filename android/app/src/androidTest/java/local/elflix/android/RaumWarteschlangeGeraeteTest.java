package local.elflix.android;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.view.View;
import android.view.ViewGroup;
import android.widget.RadioButton;
import android.widget.TextView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/** Visible queue panel and the paused native preparation used before queue ACK. */
@RunWith(AndroidJUnit4.class)
public class RaumWarteschlangeGeraeteTest {
    private static Object lesen(Object ziel, String name) throws Exception {
        Field feld = ziel.getClass().getDeclaredField(name);
        feld.setAccessible(true);
        return feld.get(ziel);
    }

    private static View queueKarte(MainActivity activity, boolean tv, String room) throws Exception {
        Method methode = MainActivity.class.getDeclaredMethod("warteschlangenKarte",
            boolean.class, String.class);
        methode.setAccessible(true);
        return (View) methode.invoke(activity, tv, room);
    }

    private static String bildStand(MainActivity activity) throws Exception {
        Method methode = MainActivity.class.getDeclaredMethod("watchpartyBild");
        methode.setAccessible(true);
        return (String) methode.invoke(activity);
    }

    private static TextView text(View view, String gesucht) {
        if (view instanceof TextView && gesucht.equals(((TextView) view).getText().toString())) {
            return (TextView) view;
        }
        if (view instanceof ViewGroup) {
            ViewGroup gruppe = (ViewGroup) view;
            for (int i = 0; i < gruppe.getChildCount(); i += 1) {
                TextView treffer = text(gruppe.getChildAt(i), gesucht);
                if (treffer != null) return treffer;
            }
        }
        return null;
    }

    private static void warten(java.util.function.BooleanSupplier test) throws Exception {
        long ende = System.currentTimeMillis() + 20_000;
        while (!test.getAsBoolean() && System.currentTimeMillis() < ende) Thread.sleep(100);
        assertTrue("Bedingung nach 20 Sekunden nicht erfüllt", test.getAsBoolean());
    }

    @Test public void echteMainActivityZeigtNurGewaehlteQueueUndSperrtOfflineAktionen() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    RaumWarteschlange queue = (RaumWarteschlange) lesen(activity,
                        "raumWarteschlange");
                    assertNotNull(queue);
                    JSONObject normal = new JSONObject().put("room", "TEST")
                        .put("selectedId", "n1").put("items", new JSONArray().put(
                            new JSONObject().put("id", "n1").put("title", "Konkrete Folge")));
                    JSONObject yt = new JSONObject().put("room", "TEST")
                        .put("items", new JSONArray().put(new JSONObject()
                            .put("id", "y1").put("title", "Queue-Video")));
                    queue.ereignis("queue:state", normal.toString());
                    queue.ereignis("ytqueue:state", yt.toString());
                    for (boolean tv : new boolean[] { false, true }) {
                        View karte = queueKarte(activity, tv, "TEST");
                        assertNotNull(text(karte, "Warteschlange"));
                        RadioButton serien = (RadioButton) text(karte, "Serien & Filme");
                        RadioButton youtube = (RadioButton) text(karte, "YouTube");
                        assertNotNull(serien);
                        assertNotNull(youtube);
                        serien.performClick();
                        assertTrue(serien.isChecked());
                        assertNotNull(text(karte, "Stimmen · Konkrete Folge"));
                        assertNull(text(karte, "Stimmen · Queue-Video"));
                        assertNotNull(text(karte, "Titel aus Merkliste vorschlagen"));
                        assertNull(text(karte, "YouTube-Runde beitreten"));
                        TextView starten = text(karte, "Ausgewählten Titel starten");
                        assertNotNull(starten);
                        assertFalse("Offline-Raum darf keinen Start auslösen", starten.isEnabled());
                        youtube.performClick();
                        assertTrue(youtube.isChecked());
                        assertFalse(serien.isChecked());
                        assertNull(text(karte, "Stimmen · Konkrete Folge"));
                        assertNull(text(karte, "Titel aus Merkliste vorschlagen"));
                        assertNull(text(karte, "Ausgewählten Titel starten"));
                        assertNotNull(text(karte, "Stimmen · Queue-Video"));
                        assertFalse(text(karte, "YouTube-Runde beitreten").isEnabled());
                        assertFalse(text(karte, "YouTube-Video vorschlagen").isEnabled());
                        assertFalse("Reiterwechsel tritt keiner YouTube-Runde bei",
                            queue.youtubeRaumAktiv("TEST"));

                        View erneuert = queueKarte(activity, tv, "TEST");
                        assertTrue("Auswahl bleibt beim Neuaufbau erhalten",
                            ((RadioButton) text(erneuert, "YouTube")).isChecked());
                        assertNotNull(text(erneuert, "Stimmen · Queue-Video"));
                        assertNull(text(erneuert, "Stimmen · Konkrete Folge"));
                        View andererRaum = queueKarte(activity, tv, "ANDERER RAUM");
                        assertTrue("Jeder Raum hat eine eigene Auswahl",
                            ((RadioButton) text(andererRaum, "Serien & Filme")).isChecked());
                        assertNull(text(andererRaum, "Stimmen · Queue-Video"));
                        serien.performClick();
                        assertNotNull(text(karte, "Stimmen · Konkrete Folge"));
                        assertNull(text(karte, "Stimmen · Queue-Video"));
                    }
                } catch (Exception fehler) { throw new AssertionError(fehler); }
            });
        }
    }

    @Test public void queueAenderungenAktualisierenDenBildstandOhneRaumAenderung() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                try {
                    Watchparty watchparty = (Watchparty) lesen(activity, "watchparty");
                    Field status = Watchparty.class.getDeclaredField("letzterStatus");
                    status.setAccessible(true);
                    status.set(watchparty, new JSONObject().put("rooms", new JSONArray()
                        .put(new JSONObject().put("room", "QUEUE-TEST"))));
                    RaumWarteschlange queue = (RaumWarteschlange) lesen(activity, "raumWarteschlange");
                    for (String event : new String[] { "queue:state", "ytqueue:state" }) {
                        String vorher = bildStand(activity);
                        JSONObject item = new JSONObject().put("id", "q1").put("title", "Vorschlag");
                        JSONObject stand = new JSONObject().put("room", "QUEUE-TEST")
                            .put("rev", 1).put("items", new JSONArray().put(item));
                        queue.ereignis(event, stand.toString());
                        String vorschlag = bildStand(activity);
                        assertNotEquals("Neuer Vorschlag muss sichtbar werden", vorher, vorschlag);
                        queue.ereignis(event, stand.put("rev", 2).toString());
                        assertEquals("Gleicher Inhalt darf keinen Neuaufbau auslösen",
                            vorschlag, bildStand(activity));
                        item.put("voted", true);
                        queue.ereignis(event, stand.toString());
                        String stimme = bildStand(activity);
                        assertNotEquals("Die eigene Stimme muss sichtbar werden", vorschlag, stimme);
                        queue.ereignis(event, stand.put("items", new JSONArray()).toString());
                        assertNotEquals("Entfernte Vorschläge müssen verschwinden",
                            stimme, bildStand(activity));
                    }
                } catch (Exception fehler) { throw new AssertionError(fehler); }
            });
        }
    }

    @Test public void queueQuelleWirdEchtGeladenUndBleibtPausiert() throws Exception {
        byte[] wav = wav(8);
        AtomicBoolean laufen = new AtomicBoolean(true);
        try (ServerSocket server = new ServerSocket(0)) {
            Thread dienst = new Thread(() -> {
                while (laufen.get()) try (Socket socket = server.accept()) {
                    java.io.BufferedReader in = new java.io.BufferedReader(
                        new java.io.InputStreamReader(socket.getInputStream()));
                    while (true) {
                        String zeile = in.readLine();
                        if (zeile == null || zeile.isEmpty()) break;
                    }
                    String kopf = "HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\n"
                        + "Content-Length: " + wav.length + "\r\nConnection: close\r\n\r\n";
                    socket.getOutputStream().write(kopf.getBytes(StandardCharsets.US_ASCII));
                    socket.getOutputStream().write(wav);
                } catch (Exception ignored) { }
            });
            dienst.setDaemon(true);
            dienst.start();
            try (ActivityScenario<DirektProbeActivity> scenario =
                     ActivityScenario.launch(DirektProbeActivity.class)) {
                AtomicBoolean kernBereit = new AtomicBoolean();
                warten(() -> {
                    scenario.onActivity(a -> kernBereit.set(a.kern.istBereit()));
                    return kernBereit.get();
                });
                scenario.onActivity(a -> {
                    a.spieler.naechsteQuellePausiert();
                    a.spieler.quelle("http://127.0.0.1:" + server.getLocalPort()
                        + "/queue.wav", "datei", Collections.emptyMap(), 0);
                });
                AtomicReference<JSONObject> stand = new AtomicReference<>();
                warten(() -> {
                    scenario.onActivity(a -> {
                        try { stand.set(a.spieler.liveStand()); }
                        catch (Exception e) { throw new AssertionError(e); }
                    });
                    return stand.get() != null && stand.get().optDouble("duration", 0) > 0;
                });
                assertTrue("Queue-Ziel muss nach echter Media3-Bereitschaft pausiert sein",
                    stand.get().optBoolean("paused", false));
                assertTrue("Queue-Ziel beginnt bei null", stand.get().optDouble("position", 1) < 0.5);
            } finally {
                laufen.set(false);
            }
        }
    }

    private static byte[] wav(int sekunden) {
        int groesse = 8000 * sekunden;
        ByteBuffer daten = ByteBuffer.allocate(44 + groesse).order(ByteOrder.LITTLE_ENDIAN);
        daten.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + groesse)
            .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1)
            .putShort((short) 1).putInt(8000).putInt(8000).putShort((short) 1)
            .putShort((short) 8).put("data".getBytes(StandardCharsets.US_ASCII)).putInt(groesse);
        while (daten.hasRemaining()) daten.put((byte) 128);
        return daten.array();
    }
}
