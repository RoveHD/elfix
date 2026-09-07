package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.res.Configuration;
import android.view.View;
import android.widget.LinearLayout;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.UiDevice;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.util.concurrent.atomic.AtomicInteger;

/** A real phone-sized composition of the shared mobile building blocks. */
@RunWith(AndroidJUnit4.class)
public class MobileViewsGeraeteTest {
    @Test public void mobileBausteineBleibenBeiGrosserSchriftBedienbarUndErzeugenEineAufnahme() {
        try (ActivityScenario<DirektProbeActivity> szene = ActivityScenario.launch(DirektProbeActivity.class)) {
            AtomicInteger klicks = new AtomicInteger();
            szene.onActivity(a -> {
                Configuration gross = new Configuration(a.getResources().getConfiguration());
                gross.fontScale = 1.3f;
                Context kontext = a.createConfigurationContext(gross);
                LinearLayout seite = new LinearLayout(kontext);
                seite.setOrientation(LinearLayout.VERTICAL);
                seite.setBackgroundColor(Theme.BACKGROUND);
                int rand = MobileViews.dp(kontext, MobileViews.SCREEN_PADDING);
                seite.setPadding(rand, rand, rand, rand);
                seite.addView(MobileViews.eyebrow(kontext, "ELFIX"));
                seite.addView(MobileViews.heroTitle(kontext, "Für dich"));
                seite.addView(MobileViews.subtitle(kontext, "Deine Serien und Filme auf einen Blick."));

                View suche = MobileViews.searchEntry(kontext, "Serien, Anime und Filme suchen", klicks::incrementAndGet);
                LinearLayout.LayoutParams sucheMasse = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, MobileViews.dp(kontext, MobileViews.TOUCH_TARGET + 4));
                sucheMasse.topMargin = MobileViews.dp(kontext, MobileViews.ITEM_GAP);
                seite.addView(suche, sucheMasse);
                seite.addView(MobileViews.sectionHeader(kontext,
                    "Weiter ansehen und fortsetzen", "Alle anzeigen", klicks::incrementAndGet));
                View filter = MobileViews.filterKnopf(kontext, "Neue Folgen", 4, true, klicks::incrementAndGet);
                seite.addView(filter);
                View reiter = MobileViews.reiter(kontext, "Dieses Jahr", "2026", true, klicks::incrementAndGet);
                seite.addView(reiter);
                Provider provider = new Provider();
                provider.id = "aniworld";
                provider.name = "AniWorld";
                View karte = MobileViews.favoriteCard(kontext, provider,
                    "Ein ungewöhnlich langer Serientitel für die große Schrift", "Staffel 12 · Folge 24",
                    "AniWorld", "", 63, "Weiter ansehen", klicks::incrementAndGet, null);
                seite.addView(karte);
                seite.addView(MobileViews.emptyState(kontext, R.drawable.ic_nav_favorite,
                    "Deine Liste ist bereit", "Füge Titel hinzu, die du später ansehen möchtest."));
                a.setContentView(seite);

                assertTrue("Die Suche braucht ein echtes Daumenziel",
                    suche.getMinimumHeight() >= MobileViews.dp(kontext, MobileViews.TOUCH_TARGET));
                assertTrue("Filter bleiben bei großer Schrift leicht zu treffen",
                    filter.getMinimumHeight() >= MobileViews.dp(kontext, MobileViews.TOUCH_TARGET));
                assertTrue("Reiter bleiben bei großer Schrift leicht zu treffen",
                    reiter.getMinimumHeight() >= MobileViews.dp(kontext, MobileViews.TOUCH_TARGET));
                assertTrue("Karten bleiben für TalkBack als Öffnen-Aktion verständlich",
                    karte.getContentDescription().toString().contains("öffnen"));
                suche.performClick();
            });
            assertEquals("Die Suchfläche bleibt bedienbar", 1, klicks.get());
            InstrumentationRegistry.getInstrumentation().waitForIdleSync();
            File bild = new File(InstrumentationRegistry.getInstrumentation().getTargetContext()
                .getExternalFilesDir(null), "mobile-views-test.png");
            assertTrue("MobileViews-Screenshot konnte nicht geschrieben werden",
                UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(bild));
        }
    }
}
