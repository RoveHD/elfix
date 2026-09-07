package local.elflix.android;

import static org.junit.Assert.*;

import android.view.View;
import android.view.ViewGroup;
import android.view.Choreographer;
import android.widget.EditText;
import android.widget.TextView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Fixture-only: prüft Raumgrenze, Rückweg und dass eine fehlgeschlagene Sendung nicht verschwindet. */
@RunWith(AndroidJUnit4.class)
public class SpielerChatGeraeteTest {
    private static EditText eingabe(View wurzel) {
        if (wurzel instanceof EditText) return (EditText) wurzel;
        if (wurzel instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) wurzel).getChildCount(); i++) {
            EditText gefunden = eingabe(((ViewGroup) wurzel).getChildAt(i));
            if (gefunden != null) return gefunden;
        }
        return null;
    }
    private static TextView text(View wurzel, String gesucht) {
        if (wurzel instanceof TextView && gesucht.contentEquals(((TextView) wurzel).getText())) return (TextView) wurzel;
        if (wurzel instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) wurzel).getChildCount(); i++) {
            TextView gefunden = text(((ViewGroup) wurzel).getChildAt(i), gesucht);
            if (gefunden != null) return gefunden;
        }
        return null;
    }
    private static View beschreibung(View wurzel, String gesucht) {
        CharSequence label = wurzel.getContentDescription();
        if (label != null && gesucht.contentEquals(label)) return wurzel;
        if (wurzel instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) wurzel).getChildCount(); i++) {
            View gefunden = beschreibung(((ViewGroup) wurzel).getChildAt(i), gesucht);
            if (gefunden != null) return gefunden;
        }
        return null;
    }
    private static JSONObject zeile(String raum, String nachricht, String name) {
        try {
            return new JSONObject().put("room", raum).put("text", nachricht).put("name", name);
        } catch (Exception fehler) { throw new AssertionError(fehler); }
    }

    @Test public void chatBleibtImAktivenRaumUndBehaeltFehlgeschlageneEingabe() throws Exception {
        try (ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            szene.onActivity(a -> {
                SpielerChat chat = new SpielerChat(a, (key, nachricht, raum, antwort) ->
                    antwort.fertig(null, "Offline"));
                chat.kontext("serie:test", "zimmer", false);
                JSONObject fremd = zeile("anderes-zimmer", "darf nicht erscheinen", "Gast");
                JSONObject passend = zeile("zimmer", "sichtbar", "Elias");
                chat.empfangen(fremd); chat.empfangen(passend); chat.oeffnen();
                assertNotNull("Nur der aktive Raum wird angezeigt", text(chat.ansicht(), "sichtbar"));
                assertNull("Eine fremde Runde darf nie in den Playerchat", text(chat.ansicht(), "darf nicht erscheinen"));
                EditText feld = eingabe(chat.ansicht());
                assertNotNull(feld); feld.setText("noch da");
                TextView senden = text(chat.ansicht(), "Senden");
                assertNotNull(senden); senden.performClick();
                assertEquals("Bei Relay-Fehler bleibt der Text zum erneuten Senden", "noch da", feld.getText().toString());
                assertTrue("Zurück schließt erst den Chat", chat.zurueck());
                assertFalse(chat.istOffen());
            });
        }
    }

    @Test public void nativerChatMachtScreenshotUndDpadCenterSchliesstFokussiert() throws Exception {
        try (ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            CountDownLatch bildFertig = new CountDownLatch(1);
            szene.onActivity(a -> {
                a.spieler.chatKontext("serie:test", "zimmer", true);
                a.spieler.chatEmpfangen(zeile("zimmer", "Live", "Elias"));
                View oeffnen = beschreibung(a.spieler.ansicht, "Livechat öffnen");
                assertNotNull("Der native Player hat einen sichtbaren Chat-Auslöser", oeffnen);
                oeffnen.performClick();
                Choreographer.getInstance().postFrameCallback(zeit -> bildFertig.countDown());
            });
            assertTrue("Der geöffnete Chat wurde nicht gerendert", bildFertig.await(5, TimeUnit.SECONDS));
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            androidx.test.uiautomator.UiDevice fernbedienung = androidx.test.uiautomator.UiDevice
                .getInstance(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation());
            File screenshot = new File(androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
                .getTargetContext().getExternalFilesDir(null), "spieler-chat-test.png");
            assertTrue("Chat-Screenshot konnte nicht geschrieben werden", fernbedienung.takeScreenshot(screenshot));
            assertTrue("Echter DPAD-Center erreicht den fokussierten Chat-Schließen-Knopf nicht",
                fernbedienung.pressDPadCenter());
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            szene.onActivity(a -> {
                View schliessen = beschreibung(a.spieler.ansicht, "Chat schließen");
                assertNotNull(schliessen);
                assertFalse("DPAD-Center darf nicht zum Player durchfallen; er schließt den fokussierten Chat",
                    schliessen.isShown());
            });
        }
    }
}
