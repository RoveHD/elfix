package local.elflix.android;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import android.view.View;
import android.graphics.Rect;
import android.widget.ScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Sichtprobe für die gemeinsamen TV-Bausteine.
 *
 * <p>Auf einem Telefon ist dies ausdrücklich eine fest gebaute TV-Vorschau;
 * der Dateiname macht den Fallback sichtbar. Auf einem Leanback-Gerät ist es
 * derselbe Aufbau in dessen echter TV-Konfiguration.
 */
@RunWith(AndroidJUnit4.class)
public class TvViewsGeraeteTest {
    private static TextView text(View wurzel, String gesucht) {
        if (wurzel instanceof TextView && gesucht.contentEquals(((TextView) wurzel).getText())) {
            return (TextView) wurzel;
        }
        if (wurzel instanceof android.view.ViewGroup) {
            android.view.ViewGroup gruppe = (android.view.ViewGroup) wurzel;
            for (int i = 0; i < gruppe.getChildCount(); i++) {
                TextView gefunden = text(gruppe.getChildAt(i), gesucht);
                if (gefunden != null) return gefunden;
            }
        }
        return null;
    }

    private static void kopfLeistePruefen(android.app.Activity activity, int breiteDp) {
        android.content.res.Configuration konfiguration = new android.content.res.Configuration(
            activity.getResources().getConfiguration());
        konfiguration.screenWidthDp = breiteDp;
        android.content.Context context = activity.createConfigurationContext(konfiguration);
        LinearLayout leiste = new LinearLayout(context);
        leiste.setOrientation(LinearLayout.HORIZONTAL);
        String[] namen = { "Start", "Suche", "Favoriten", "Watchparty", "Einstellungen" };
        int[] symbole = { R.drawable.ic_nav_home, R.drawable.ic_nav_search, R.drawable.ic_nav_favorite,
            R.drawable.ic_play, R.drawable.ic_nav_settings };
        ArrayList<View> knoepfe = new ArrayList<>();
        for (int i = 0; i < namen.length; i++) {
            View knopf = TvViews.headerButton(context, symbole[i], namen[i], () -> { });
            LinearLayout.LayoutParams platz = new LinearLayout.LayoutParams(-2, -2);
            platz.leftMargin = TvViews.dp(context, 10); // MainActivity.headerSlot()
            leiste.addView(knopf, platz);
            knoepfe.add(knopf);
        }
        leiste.measure(View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
        int verfuegbar = TvViews.dp(context, breiteDp - 2 * TvViews.SCREEN_PADDING - 132);
        assertTrue("Fünf Produktions-Kopfziele passen bei " + breiteDp + " dp neben das Logo",
            leiste.getMeasuredWidth() <= verfuegbar);
        leiste.layout(0, 0, leiste.getMeasuredWidth(), leiste.getMeasuredHeight());
        for (int i = 0; i < namen.length; i++) {
            TextView beschriftung = text(knoepfe.get(i), namen[i]);
            assertNotNull("Kopfziel fehlt: " + namen[i], beschriftung);
            assertTrue("Kopfziel abgeschnitten: " + namen[i],
                beschriftung.getRight() <= knoepfe.get(i).getWidth());
        }
    }

    @Test public void schreibtRepräsentativeTvAnsichtAlsScreenshot() throws Exception {
        try (ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            CountDownLatch bild = new CountDownLatch(1);
            final boolean[] fernseher = new boolean[1];
            final View[] ersteKarte = new View[1];
            final TextView[] ersterTitel = new TextView[1];
            szene.onActivity(a -> {
                fernseher[0] = DirektSpieler.istFernseher(a.getResources().getConfiguration());
                ScrollView scroll = new ScrollView(a);
                scroll.setFillViewport(true);
                LinearLayout seite = new LinearLayout(a);
                seite.setOrientation(LinearLayout.VERTICAL);
                seite.setBackgroundColor(Theme.BACKGROUND);
                int rand = TvViews.dp(a, TvViews.SCREEN_PADDING);
                seite.setPadding(rand, TvViews.dp(a, 28), rand, rand);

                seite.addView(TvViews.eyebrow(a, fernseher[0] ? "TV-STARTSEITE" : "TV-VORSCHAU · TELEFON"));
                seite.addView(TvViews.heroTitle(a, "Weitersehen, ohne zu suchen"));
                seite.addView(TvViews.body(a, "Große Karten, ruhige Flächen und ein klarer Fokus für die Fernbedienung."));
                LinearLayout.LayoutParams kopfAbstand = new LinearLayout.LayoutParams(-1, -2);
                kopfAbstand.topMargin = TvViews.dp(a, TvViews.SECTION_GAP);
                seite.addView(TvViews.sectionHeader(a, "Deine Reihen", "Alle anzeigen", () -> { }), kopfAbstand);

                Provider anbieter = new Provider();
                anbieter.id = "aniworld"; anbieter.name = "AniWorld"; anbieter.logo = "AW";
                int breite = TvViews.kachelBreiteDp(a);
                ArrayList<View> karten = new ArrayList<>();
                karten.add(TvViews.kachel(a, anbieter, "Attack on Titan", "Staffel 3 · Folge 7",
                    "", 62, "Neue Folge", breite, null, () -> { }, null));
                karten.add(TvViews.kachel(a, anbieter, "Frieren", "Staffel 1 · Folge 16",
                    "", 28, "", breite, null, () -> { }, null));
                karten.add(TvViews.mehrKarte(a, "Alle Titel", breite, () -> { }));
                android.widget.HorizontalScrollView reihe = TvViews.reihe(a, karten);
                assertTrue("Die Fokusvergrößerung darf nicht am Reihenrand abgeschnitten werden",
                    !reihe.getClipChildren() && !reihe.getClipToPadding());
                LinearLayout.LayoutParams reihenAbstand = new LinearLayout.LayoutParams(-1, -2);
                reihenAbstand.topMargin = TvViews.dp(a, 8);
                seite.addView(reihe, reihenAbstand);
                scroll.addView(seite, new ScrollView.LayoutParams(-1, -2));
                a.setContentView(scroll);
                assertNotNull("Die erste TV-Karte muss ein Fokusziel sein", karten.get(0));
                karten.get(0).requestFocus();
                ersteKarte[0] = karten.get(0);
                ersterTitel[0] = text(karten.get(0), "Attack on Titan");
                seite.post(() -> {
                    // Die Hauptseite ist ebenfalls vertikal scrollbar. Der
                    // Nachweis zeigt daher die gerade fokussierte Karte samt
                    // Titel, nicht nur ihren Poster-Ausschnitt.
                    if (ersterTitel[0] != null) ersterTitel[0].requestRectangleOnScreen(
                        new Rect(0, 0, ersterTitel[0].getWidth(), ersterTitel[0].getHeight()), true);
                    bild.countDown();
                });
            });
            assertTrue("TV-Vorschau wurde nicht gezeichnet", bild.await(5, TimeUnit.SECONDS));
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            szene.onActivity(a -> {
                Rect sichtbar = new Rect();
                assertNotNull("Der Titel unter der Karte fehlt", ersterTitel[0]);
                assertTrue("Der Kartentitel muss nach Fokus-Scroll wirklich sichtbar sein",
                    ersterTitel[0].getGlobalVisibleRect(sichtbar) && sichtbar.height() >= ersterTitel[0].getHeight());
                assertTrue("Die sichtbare Fokuskarte muss ihren D-pad-Fokus behalten", ersteKarte[0].hasFocus());
                assertTrue("Die Fokuskarte darf nicht durch ihren Reihencontainer beschnitten sein",
                    ersteKarte[0].getScaleX() >= 1f && ersteKarte[0].isShown());
            });
            UiDevice geraet = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
            File ziel = new File(InstrumentationRegistry.getInstrumentation().getTargetContext()
                .getExternalFilesDir(null), fernseher[0] ? "tvviews-tv-test.png" : "tvviews-phone-fallback-test.png");
            assertTrue("TV-Vorschau-Screenshot konnte nicht geschrieben werden", geraet.takeScreenshot(ziel));
        }
    }

    @Test public void fünfProduktionsKopfzielePassenNebenDasLogo() {
        try (ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            szene.onActivity(a -> {
                kopfLeistePruefen(a, 960);
                kopfLeistePruefen(a, 1280);
            });
        }
    }

    @Test public void schnellerFokuswechselBeendetAuftrittUndAltenSchatten() throws Exception {
        try (ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            CountDownLatch fertig = new CountDownLatch(1);
            View[] karten = new View[2];
            szene.onActivity(a -> {
                LinearLayout reihe = new LinearLayout(a);
                for (int i = 0; i < karten.length; i++) {
                    karten[i] = TvViews.headerButton(a, R.drawable.ic_nav_home, "Ziel " + i, () -> {});
                    reihe.addView(karten[i]);
                }
                a.setContentView(reihe);
                reihe.post(() -> {
                    karten[1].requestFocus();
                    Bewegung.auftritt(karten[0], 500L);
                    karten[0].requestFocus();
                    assertEquals("Fokus darf keinen halb unsichtbaren Auftritt hinterlassen",
                        1f, karten[0].getAlpha(), 0.001f);
                    assertEquals(0f, karten[0].getTranslationY(), 0.001f);
                    karten[1].requestFocus();
                    karten[0].requestFocus();
                    if (!Bewegung.an(a)) fertig.countDown();
                    else karten[0].animate().setListener(new android.animation.AnimatorListenerAdapter() {
                        @Override public void onAnimationEnd(android.animation.Animator animation) {
                            fertig.countDown();
                        }
                    });
                });
            });
            assertTrue("Die letzte Fokusanimation muss enden", fertig.await(5, TimeUnit.SECONDS));
            szene.onActivity(a -> {
                assertTrue(karten[0].hasFocus());
                assertEquals(1.02f, karten[0].getScaleX(), 0.001f);
                assertEquals(TvViews.dp(a, 12), karten[0].getZ(), 0.1f);
                assertEquals(1f, karten[1].getScaleX(), 0.001f);
                assertEquals(0f, karten[1].getZ(), 0.1f);
            });
        }
    }
}
