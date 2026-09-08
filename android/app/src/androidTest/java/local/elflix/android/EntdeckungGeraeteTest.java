package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.view.KeyEvent;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.List;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Reales Raster mit vielen lokalen Empfehlungen, ohne einen Produktions-Testschalter. */
@RunWith(AndroidJUnit4.class)
public class EntdeckungGeraeteTest {
    private static Object lesen(Object ziel, String name) throws Exception {
        Field feld = ziel.getClass().getDeclaredField(name);
        feld.setAccessible(true);
        return feld.get(ziel);
    }

    private static void schreiben(Object ziel, String name, Object wert) throws Exception {
        Field feld = ziel.getClass().getDeclaredField(name);
        feld.setAccessible(true);
        feld.set(ziel, wert);
    }

    private static Object rufen(Object ziel, String name, Class<?>[] typen, Object... werte)
        throws Exception {
        Method methode = ziel.getClass().getDeclaredMethod(name, typen);
        methode.setAccessible(true);
        return methode.invoke(ziel, werte);
    }

    private static void fuellen(MainActivity activity, int anzahl) throws Exception {
        schreiben(activity, "entdeckungArt", Empfehlungen.SERIE);
        Object zustand = rufen(activity, "entdeckungsZustand", new Class<?>[0]);
        Field eintraegeFeld = zustand.getClass().getDeclaredField("eintraege");
        eintraegeFeld.setAccessible(true);
        @SuppressWarnings("unchecked") List<JSONObject> eintraege =
            (List<JSONObject>) eintraegeFeld.get(zustand);
        eintraege.clear();
        for (int i = 0; i < anzahl; i += 1) {
            eintraege.add(new JSONObject()
                .put("werkKey", "geraete-entdeckung-" + i)
                .put("url", "https://probe.invalid/entdeckung/" + i)
                .put("title", "Geräteempfehlung " + i)
                .put("grundText", "Weil diese lokale Probe das Sichtfenster prüft.")
                .put("providerName", "Probe"));
        }
        for (String name : new String[]{"laeuft", "fertig", "waechst"}) {
            Field feld = zustand.getClass().getDeclaredField(name);
            feld.setAccessible(true);
            feld.setBoolean(zustand, "fertig".equals(name));
        }
        rufen(activity, "zeigeEntdeckung", new Class<?>[]{String.class}, Empfehlungen.SERIE);
    }

    private static int spalten(MainActivity activity) throws Exception {
        return (Integer) rufen(activity, "entdeckungsSpalten", new Class<?>[0]);
    }

    private static LinearLayout zeilen(MainActivity activity) throws Exception {
        return (LinearLayout) lesen(activity, "entdeckungZeilen");
    }

    private static void nachlegen(MainActivity activity, int ab) throws Exception {
        Object zustand = rufen(activity, "entdeckungsZustand", new Class<?>[0]);
        Field feld = zustand.getClass().getDeclaredField("eintraege");
        feld.setAccessible(true);
        @SuppressWarnings("unchecked") List<JSONObject> eintraege = (List<JSONObject>) feld.get(zustand);
        eintraege.add(new JSONObject().put("werkKey", "nachschlag-" + ab)
            .put("url", "https://probe.invalid/nachschlag/" + ab).put("title", "Nachschlag " + ab));
        rufen(activity, "entdeckungKartenAnhaengen", new Class<?>[]{int.class}, ab);
    }

    @Test public void nachschlagFuelltTeilzeileUndDerSechzigsteEintragVirtualisiert() throws Exception {
        Pruefhilfe.appStarten();
        Pruefhilfe.aufApp(a -> { try { fuellen(a, 57); } catch (Exception e) { throw new AssertionError(e); } });
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        Pruefhilfe.aufApp(a -> {
            try {
                int spalten = spalten(a);
                nachlegen(a, 57);
                View reihe = zeilen(a).findViewWithTag(57 / spalten);
                assertNotNull("Nachschlag-Zeile fehlt", reihe);
                assertTrue("Der frühere Platzhalter wurde durch eine Karte ersetzt",
                    ((LinearLayout) reihe).getChildAt(57 % spalten).isClickable());
                fuellen(a, 59);
                nachlegen(a, 59);
                assertTrue("Der sechzigste Eintrag schaltet auf das begrenzte Fenster um",
                    zeilen(a).getChildCount() <= 10);
            } catch (Exception e) { throw new AssertionError(e); }
        });
    }

    @Test public void sichtfensterBleibtBei50_200Und500KartenBegrenztUndScrollbar() throws Exception {
        Pruefhilfe.appStarten();
        for (int anzahl : new int[]{50, 200, 500}) {
            final int karten = anzahl;
            Pruefhilfe.aufApp(a -> {
                try { fuellen(a, karten); }
                catch (Exception fehler) { throw new AssertionError(fehler); }
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Pruefhilfe.aufApp(a -> {
                    try {
                        LinearLayout zeilen = zeilen(a);
                        ScrollView scroll = (ScrollView) lesen(a, "seitenScroll");
                        int erwartet = (karten + spalten(a) - 1) / spalten(a);
                        assertNotNull("Entdeckungszeilen fehlen", zeilen);
                        if (karten < 60) assertEquals("Kleine Listen bleiben voll aufgebaut", erwartet,
                            zeilen.getChildCount());
                        else assertTrue("Das Raster darf bei " + karten + " Karten nie mehr als zehn Zeilen halten",
                            zeilen.getChildCount() <= 10);
                        assertTrue("Die Scrollhoehe muss alle " + karten + " Karten abbilden",
                            scroll.getChildAt(0).getHeight() > scroll.getHeight());
                        scroll.scrollTo(0, scroll.getChildAt(0).getHeight());
                    } catch (Exception fehler) { throw new AssertionError(fehler); }
            });
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            Pruefhilfe.aufApp(a -> {
                    try {
                        ScrollView scroll = (ScrollView) lesen(a, "seitenScroll");
                        assertTrue("Scrollen erreicht den unteren Entdeckungsbereich", scroll.getScrollY() > 0);
                        if (karten >= 60) assertTrue("Nach dem Scrollen bleibt das Sichtfenster begrenzt",
                            zeilen(a).getChildCount() <= 10);
                    } catch (Exception fehler) { throw new AssertionError(fehler); }
            });
        }
    }

    @Test public void tvDpadMaterialisiertEineKarteHinterDemSichtfensterUndBehaeltDenFokus() throws Exception {
        Pruefhilfe.appStarten();
        Pruefhilfe.aufApp(a -> {
                try { fuellen(a, 500); }
                catch (Exception fehler) { throw new AssertionError(fehler); }
        });
        InstrumentationRegistry.getInstrumentation().waitForIdleSync();
        Pruefhilfe.aufApp(a -> {
                try {
                    if (!DirektSpieler.istFernseher(a.getResources().getConfiguration())) return;
                    View start = zeilen(a).findViewWithTag("tv:entdeckung:0");
                    assertNotNull("Die erste TV-Karte fehlt", start);
                    start.requestFocus();
                } catch (Exception fehler) { throw new AssertionError(fehler); }
        });
            // Mehr Zeilenspruenge als der zehnzeilige Puffer traegt. Das
            // Steuerkreuz muss den naechsten Zielindex vorher anbauen.
            for (int i = 0; i < 14; i += 1) {
                Pruefhilfe.aufApp(a -> a.dispatchKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN,
                    KeyEvent.KEYCODE_DPAD_DOWN)));
                InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            }
            Pruefhilfe.aufApp(a -> {
                try {
                    if (!DirektSpieler.istFernseher(a.getResources().getConfiguration())) return;
                    View fokus = a.getCurrentFocus();
                    assertNotNull("D-pad verlor den Kartenfokus", fokus);
                    assertTrue("D-pad muss hinter das ursprüngliche Zehn-Zeilen-Fenster gelangen",
                        fokus.getTag() instanceof String && ((String) fokus.getTag()).matches("tv:entdeckung:([4-9][0-9]|[1-9][0-9]{2,})"));
                    assertTrue("Auch nach D-pad-Nachlegen bleiben hoechstens zehn Reihen",
                        zeilen(a).getChildCount() <= 10);
                } catch (Exception fehler) { throw new AssertionError(fehler); }
            });
    }
}
