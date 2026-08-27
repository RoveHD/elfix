package local.elflix.android;

import android.animation.ValueAnimator;
import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.view.animation.Interpolator;
import android.view.animation.PathInterpolator;

/**
 * Die Bewegungen der Oberflaeche - an einer Stelle, damit sie sich gleich
 * anfuehlen und sich gemeinsam abschalten lassen.
 *
 * <p><b>Was hier nicht steht, ist so wichtig wie was hier steht.</b> Eine
 * Animation kann ein Zucken verdecken, aber sie beseitigt es nicht - sie macht
 * es nur langsamer. Deshalb bewegt sich hier nur, was einen Uebergang
 * <em>bedeutet</em>: eine Kachel geht weg, eine kommt dazu, ein Bereich steht
 * zum ersten Mal da. Ein Fortschritt, der alle fuenf Sekunden eine Sekunde
 * weiterrueckt, bewegt sich nicht - er springt still, und das ist richtig so.
 *
 * <p><b>Wer die Bewegung abgeschaltet hat, bekommt keine.</b> Android hat kein
 * {@code prefers-reduced-motion} wie eine Webseite; es hat die Entwickler-
 * einstellung "Animationsdauer" und, darauf aufbauend,
 * {@link ValueAnimator#areAnimatorsEnabled()}. Steht sie auf aus, gibt
 * {@link #dauer} eine Null zurueck, und jede Stelle hier prueft darauf und
 * setzt den Endzustand sofort. Kein Ort in der App darf eine feste Dauer
 * verwenden.
 */
public final class Bewegung {
    /** Druck- und Fokusreaktionen: gerade eben spuerbar. */
    public static final long KURZ = 150L;
    /** Einblenden, Ausblenden, Uebergaenge. Die Mitte des geforderten Fensters. */
    public static final long MITTEL = 200L;
    /** Zusammenziehen beim Loeschen - der laengste Weg, den etwas hier geht. */
    public static final long LANG = 250L;

    /**
     * Die uebliche Kurve: schnell los, weich aus. Sie ist der Grund, warum
     * zweihundert Millisekunden nach zweihundert Millisekunden aussehen und
     * nicht nach einer halben Sekunde.
     */
    public static Interpolator kurve() {
        return new PathInterpolator(0.2f, 0f, 0f, 1f);
    }

    private Bewegung() {
    }

    /**
     * Wie lange etwas dauern darf - null, wenn das Geraet keine Animationen
     * will.
     */
    public static long dauer(Context context, long gewuenscht) {
        if (context == null) return 0L;
        try {
            if (!ValueAnimator.areAnimatorsEnabled()) return 0L;
        } catch (Exception fehler) {
            // Eine Auskunft, die nicht zu bekommen ist, wird als "aus"
            // gelesen: lieber keine Bewegung als eine, die niemand wollte.
            return 0L;
        }
        return gewuenscht;
    }

    /** Ob sich ueberhaupt etwas bewegen darf. */
    public static boolean an(Context context) {
        return dauer(context, MITTEL) > 0L;
    }

    /**
     * Eine Ansicht, die neu dazugekommen ist, sanft aufkommen lassen.
     *
     * <p>Bewusst nur Deckkraft und ein kleiner Weg von unten - kein Springen,
     * kein Skalieren. Was hier gross einfaehrt, faellt beim zweiten Mal auf.
     */
    public static void einblenden(View ansicht) {
        if (ansicht == null) return;
        long dauer = dauer(ansicht.getContext(), MITTEL);
        if (dauer <= 0) {
            ansicht.setAlpha(1f);
            ansicht.setTranslationY(0f);
            return;
        }
        ansicht.setAlpha(0f);
        ansicht.setTranslationY(ansicht.getResources().getDisplayMetrics().density * 8f);
        ansicht.animate().alpha(1f).translationY(0f)
            .setDuration(dauer).setInterpolator(kurve()).start();
    }

    /**
     * Eine Kachel gehen lassen: erst blass werden, dabei zusammenziehen, dann
     * ist sie weg.
     *
     * <p>Das Zusammenziehen ist der Punkt. Nur auszublenden hinterliesse ein
     * Loch, in das die Liste anschliessend hineinspringt - und genau dieses
     * Springen war die Meldung. Die Hoehe laeuft deshalb mit der Deckkraft
     * gegen null, und der Nachbar rueckt waehrenddessen nach statt danach.
     *
     * @param danach laeuft, wenn nichts mehr zu sehen ist - dort gehoert das
     *               wirkliche Loeschen hin
     */
    public static void ausblendenUndZusammenziehen(View ansicht, Runnable danach) {
        if (ansicht == null) {
            if (danach != null) danach.run();
            return;
        }
        long dauer = dauer(ansicht.getContext(), LANG);
        int hoehe = ansicht.getHeight();
        if (dauer <= 0 || hoehe <= 0) {
            if (danach != null) danach.run();
            return;
        }
        ViewGroup.LayoutParams masse = ansicht.getLayoutParams();
        ValueAnimator lauf = ValueAnimator.ofFloat(1f, 0f);
        lauf.setDuration(dauer);
        lauf.setInterpolator(kurve());
        lauf.addUpdateListener(schritt -> {
            float anteil = (float) schritt.getAnimatedValue();
            ansicht.setAlpha(anteil);
            if (masse != null) {
                masse.height = Math.max(1, Math.round(hoehe * anteil));
                ansicht.setLayoutParams(masse);
            }
        });
        lauf.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(android.animation.Animator wer) {
                // Die Masse zurueckstellen: die Ansicht kann aus einem Pool
                // kommen und stuende sonst beim naechsten Mal einen Pixel hoch
                // da.
                if (masse != null) {
                    masse.height = hoehe;
                    ansicht.setLayoutParams(masse);
                }
                ansicht.setAlpha(1f);
                if (danach != null) danach.run();
            }
        });
        lauf.start();
    }
}
