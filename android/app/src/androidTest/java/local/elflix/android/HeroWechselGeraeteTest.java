package local.elflix.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/** Geraetenahe Regressionen fuer den atomaren Wechsel des Titelhintergrunds. */
@RunWith(AndroidJUnit4.class)
public final class HeroWechselGeraeteTest {
    private static final String BILD_B = "test://hero/b";
    private static final String BILD_C = "test://hero/c";

    @Test public void nurNeuesteAnfrageUebernimmtBildTitelUndAktion() throws Exception {
        GesteuerterLader lader = new GesteuerterLader();
        AtomicReference<View> hero = new AtomicReference<>();
        AtomicReference<ImageView> bild = new AtomicReference<>();
        AtomicInteger altKlicks = new AtomicInteger();
        AtomicInteger bKlicks = new AtomicInteger();
        AtomicInteger cKlicks = new AtomicInteger();
        CountDownLatch cUebernommen = new CountDownLatch(1);

        try (ActivityScenario<DirektProbeActivity> szene =
                 ActivityScenario.launch(DirektProbeActivity.class)) {
            szene.onActivity(a -> {
                View kasten = MobileViews.hero(a, "WEITER", "Alpha", "Alt", "", 12,
                    "Alpha starten", altKlicks::incrementAndGet, null, null);
                ImageView motiv = heroBild(kasten);
                Bitmap rot = einfarbig(Color.RED);
                Bilder.vorbereitetZeigen(motiv, "alt", rot);
                a.setContentView(kasten);
                hero.set(kasten);
                bild.set(motiv);

                MobileViews.heroWechsel(kasten, motiv, true, BILD_B, 360, 260,
                    () -> zustandSetzen(kasten, "Beta", "Beta starten", bKlicks), lader);
                MobileViews.heroWechsel(kasten, motiv, true, BILD_C, 360, 260,
                    () -> {
                        zustandSetzen(kasten, "Gamma", "Gamma starten", cKlicks);
                        cUebernommen.countDown();
                    }, lader);

                assertEquals("Alpha", titel(kasten).getText().toString());
                assertEquals(Color.RED, farbe(motiv));
                hauptknopf(kasten).performClick();
            });
            assertEquals("Die bisherige Aktion bleibt bis zum fertigen Bild aktiv", 1, altKlicks.get());

            szene.onActivity(a -> lader.erfolg(BILD_C, "c-key", einfarbig(Color.BLUE)));
            assertTrue("Das neueste Bild wurde nicht rechtzeitig uebernommen",
                cUebernommen.await(2, TimeUnit.SECONDS));
            szene.onActivity(a -> {
                assertEquals("Gamma", titel(hero.get()).getText().toString());
                assertEquals(Color.BLUE, farbe(bild.get()));
                hauptknopf(hero.get()).performClick();
            });
            assertEquals(1, cKlicks.get());

            // Die spaete Antwort von B darf keinen Teil des sichtbaren C-Zustands aendern.
            szene.onActivity(a -> lader.erfolg(BILD_B, "b-key", einfarbig(Color.GREEN)));
            szene.onActivity(a -> {
                assertEquals("Gamma", titel(hero.get()).getText().toString());
                assertEquals(Color.BLUE, farbe(bild.get()));
                hauptknopf(hero.get()).performClick();
            });
            assertEquals(0, bKlicks.get());
            assertEquals(2, cKlicks.get());
        }
    }

    @Test public void fehlendesBildUebernimmtPlatzhalterTitelUndAktionGemeinsam() throws Exception {
        GesteuerterLader lader = new GesteuerterLader();
        AtomicReference<View> hero = new AtomicReference<>();
        AtomicReference<ImageView> bild = new AtomicReference<>();
        AtomicInteger neuKlicks = new AtomicInteger();
        CountDownLatch uebernommen = new CountDownLatch(1);

        try (ActivityScenario<DirektProbeActivity> szene =
                 ActivityScenario.launch(DirektProbeActivity.class)) {
            szene.onActivity(a -> {
                View kasten = MobileViews.hero(a, "WEITER", "Alpha", "Alt", "", 12,
                    "Alpha starten", () -> { }, null, null);
                ImageView motiv = heroBild(kasten);
                Bilder.vorbereitetZeigen(motiv, "alt", einfarbig(Color.RED));
                a.setContentView(kasten);
                hero.set(kasten);
                bild.set(motiv);

                MobileViews.heroWechsel(kasten, motiv, true, BILD_B, 360, 260,
                    () -> {
                        zustandSetzen(kasten, "Ohne Bild", "Trotzdem starten", neuKlicks);
                        uebernommen.countDown();
                    }, lader);
                assertEquals("Alpha", titel(kasten).getText().toString());
                assertEquals(Color.RED, farbe(motiv));
            });

            szene.onActivity(a -> lader.fehler(BILD_B, "b-key"));
            assertTrue("Der Fehlerzustand wurde nicht rechtzeitig uebernommen",
                uebernommen.await(2, TimeUnit.SECONDS));
            szene.onActivity(a -> {
                assertEquals("Ohne Bild", titel(hero.get()).getText().toString());
                assertNull("Ein Fehler soll den bewussten Platzhalter zeigen", bild.get().getDrawable());
                assertEquals(View.GONE, bild.get().getVisibility());
                hauptknopf(hero.get()).performClick();
            });
            assertEquals(1, neuKlicks.get());
        }
    }

    @Test public void unveraendertesBildBleibtOhneLadenUndOhneBlendeStehen() {
        GesteuerterLader lader = new GesteuerterLader();
        AtomicInteger klicks = new AtomicInteger();
        try (ActivityScenario<DirektProbeActivity> szene =
                 ActivityScenario.launch(DirektProbeActivity.class)) {
            szene.onActivity(a -> {
                View kasten = MobileViews.hero(a, "WEITER", "Alpha", "Alt", "", 12,
                    "Alpha starten", () -> { }, null, null);
                ImageView motiv = heroBild(kasten);
                Bitmap art = einfarbig(Color.MAGENTA);
                Bilder.vorbereitetZeigen(motiv, schluessel(motiv, BILD_C, 360, 260), art);
                a.setContentView(kasten);

                MobileViews.heroWechsel(kasten, motiv, false, BILD_C, 360, 260,
                    () -> zustandSetzen(kasten, "Alpha", "Aktualisiert", klicks), lader);

                assertEquals(0, lader.anzahl());
                assertEquals(1f, kasten.getAlpha(), 0f);
                assertSame(art, ((BitmapDrawable) motiv.getDrawable()).getBitmap());
                assertEquals("Aktualisiert", hauptknopf(kasten).getText().toString());
                hauptknopf(kasten).performClick();
            });
            assertEquals(1, klicks.get());
        }
    }

    private static Bitmap einfarbig(int farbe) {
        Bitmap bild = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);
        bild.eraseColor(farbe);
        return bild;
    }

    private static int farbe(ImageView bild) {
        assertTrue(bild.getDrawable() instanceof BitmapDrawable);
        return ((BitmapDrawable) bild.getDrawable()).getBitmap().getPixel(0, 0);
    }

    private static String schluessel(ImageView bild, String adresse, int breiteDp, int hoeheDp) {
        float dichte = bild.getContext().getResources().getDisplayMetrics().density;
        return adresse + "@" + Math.max(1, Math.round(breiteDp * dichte))
            + "x" + Math.max(1, Math.round(hoeheDp * dichte));
    }

    private static TextView titel(View hero) {
        return (TextView) hero.findViewWithTag(MobileViews.HERO_TITEL);
    }

    private static ImageView heroBild(View hero) {
        return (ImageView) ((ViewGroup) hero).getChildAt(0);
    }

    private static TextView hauptknopf(View hero) {
        return (TextView) hero.findViewWithTag(MobileViews.HERO_HAUPTKNOPF);
    }

    private static void zustandSetzen(View hero, String titel, String aktion,
                                      AtomicInteger klicks) {
        titel(hero).setText(titel);
        TextView knopf = hauptknopf(hero);
        knopf.setText(aktion);
        knopf.setEnabled(true);
        knopf.setVisibility(View.VISIBLE);
        knopf.setOnClickListener(v -> klicks.incrementAndGet());
    }

    /** Liefert Antworten erst dann, wenn der Test die Reihenfolge bestimmt. */
    private static final class GesteuerterLader implements MobileViews.HeroBildLader {
        private final Map<String, Bilder.BildAntwort> offen = new HashMap<>();

        @Override public void vorbereiten(android.content.Context context, String adresse,
                                          int breiteDp, int hoeheDp,
                                          Bilder.BildAntwort antwort) {
            offen.put(adresse, antwort);
        }

        int anzahl() {
            return offen.size();
        }

        void erfolg(String adresse, String schluessel, Bitmap bild) {
            Bilder.BildAntwort antwort = offen.remove(adresse);
            assertFalse("Unbekannte Bildanfrage: " + adresse, antwort == null);
            antwort.bereit(schluessel, bild);
        }

        void fehler(String adresse, String schluessel) {
            Bilder.BildAntwort antwort = offen.remove(adresse);
            assertFalse("Unbekannte Bildanfrage: " + adresse, antwort == null);
            antwort.fehlgeschlagen(schluessel);
        }
    }
}
