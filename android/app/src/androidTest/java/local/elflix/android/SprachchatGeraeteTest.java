package local.elflix.android;

import android.os.SystemClock;
import android.webkit.WebView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.lang.reflect.Field;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Echte WebView-Sicherheitsprobe; ohne Provider, Remote-Daten und Capture-Freigabe. */
@RunWith(AndroidJUnit4.class)
public class SprachchatGeraeteTest {
    @Test public void mikrofonEinstellungenOeffnenOhneRaumUndOhneWatchparty() throws Exception {
        android.content.Intent intent = new android.content.Intent(InstrumentationRegistry.getInstrumentation().getTargetContext(),
            SprachchatProbeActivity.class).putExtra("settings", true);
        try (ActivityScenario<SprachchatProbeActivity> scenario = ActivityScenario.launch(intent)) {
            WebView[] view = new WebView[1];
            scenario.onActivity(activity -> {
                try {
                    Field field = Sprachchat.class.getDeclaredField("view");
                    field.setAccessible(true);
                    view[0] = (WebView) field.get(activity.sprachchat);
                } catch (Exception error) { throw new AssertionError(error); }
            });
            assertNotNull(view[0]);
            waitFor(view[0], "Boolean(window.ElfixVoiceHost && document.getElementById('einstellungen')?.open)", "true");
            assertEquals("true", js(view[0], "document.getElementById('mikrofon').hidden && document.getElementById('beitreten').disabled"));
            js(view[0], "window.__voicePrefs=false; ElfixVoiceHost.savePreferences({inputDeviceId:'fixture-mic'}).then(()=>ElfixVoiceHost.preferences()).then(p=>{window.__voicePrefs=p.inputDeviceId;});true");
            waitFor(view[0], "window.__voicePrefs", "\"fixture-mic\"");
            scenario.onActivity(activity -> {
                activity.sprachchat.kontextAktualisieren();
                assertTrue(activity.sprachchat.istSichtbar());
                assertNull(SprachchatDienst.beobachter);
            });
        }
    }

    @Test public void lokaleUiStartetOhneCaptureUndFremdeNavigationBleibtBlockiert() throws Exception {
        try (ActivityScenario<SprachchatProbeActivity> scenario = ActivityScenario.launch(SprachchatProbeActivity.class)) {
            WebView[] view = new WebView[1];
            scenario.onActivity(activity -> {
                try {
                    Field field = Sprachchat.class.getDeclaredField("view");
                    field.setAccessible(true);
                    view[0] = (WebView) field.get(activity.sprachchat);
                } catch (Exception error) { throw new AssertionError(error); }
            });
            assertNotNull(view[0]);
            waitFor(view[0], "Boolean(window.ElfixVoiceHost && window.ElfixVoiceControls && navigator.mediaDevices)", "true");
            assertEquals("true", js(view[0], "document.getElementById('mikrofon').hidden && !window.__voiceCapture"));
            js(view[0], "window.__voiceCapture='pending'; navigator.mediaDevices.getUserMedia({audio:true,video:false}).then(s=>{s.getTracks().forEach(t=>t.stop());window.__voiceCapture='UNEXPECTED';},e=>{window.__voiceCapture=e.name;});true");
            waitFor(view[0], "window.__voiceCapture", "\"NotAllowedError\"");
            js(view[0], "location.href='https://provider.invalid/';true");
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            assertEquals("\"" + SprachchatSicherheit.SEITE + "\"", js(view[0], "location.href"));
            scenario.onActivity(activity -> {
                assertTrue(activity.sprachchat.zurueck());
                assertFalse(activity.sprachchat.istSichtbar());
                activity.sprachchat.wiederOeffnen();
                assertTrue(activity.sprachchat.istSichtbar());
                activity.sprachchat.schliessen();
                assertNull(SprachchatDienst.beobachter);
            });
        }
    }

    private static String js(WebView view, String script) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        String[] result = new String[1];
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> view.evaluateJavascript(script, value -> {
            result[0] = value; done.countDown();
        }));
        assertTrue("WebView callback", done.await(5, TimeUnit.SECONDS));
        return result[0];
    }

    private static void waitFor(WebView view, String script, String expected) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + 15000;
        String actual;
        do {
            actual = js(view, script);
            if (expected.equals(actual)) return;
            SystemClock.sleep(50);
        } while (SystemClock.elapsedRealtime() < deadline);
        assertEquals(expected, actual);
    }
}
