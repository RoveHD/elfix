package local.elflix.android;

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.IntConsumer;

/** Baut TV-Karten in kleinen Portionen zwischen den Eingabe-Frames. Nur im UI-Thread verwenden. */
final class TvNachladung {
    private static final int VORLAUF = 3;
    private static final int SCHRITT = 6;
    private static final int PRO_FRAME = 2;
    private final int vorrat;
    private final BooleanSupplier aktuell;
    private final Consumer<Runnable> spaeter;
    private final IntConsumer bauen;
    private int gezeigt;
    private int ziel;
    private boolean angemeldet;

    TvNachladung(int vorrat, int gezeigt, BooleanSupplier aktuell,
                 Consumer<Runnable> spaeter, IntConsumer bauen) {
        this.vorrat = Math.max(0, vorrat);
        this.gezeigt = Math.max(0, Math.min(gezeigt, this.vorrat));
        this.ziel = this.gezeigt;
        this.aktuell = aktuell;
        this.spaeter = spaeter;
        this.bauen = bauen;
    }

    void anfordern(int fokus) {
        if (!aktuell.getAsBoolean() || gezeigt >= vorrat || fokus < gezeigt - VORLAUF) return;
        ziel = Math.max(ziel, Math.min(vorrat, gezeigt + SCHRITT));
        anmelden();
    }

    private void anmelden() {
        if (angemeldet) return;
        angemeldet = true;
        spaeter.accept(this::nachlegen);
    }

    private void nachlegen() {
        if (!aktuell.getAsBoolean()) {
            angemeldet = false;
            return;
        }
        int bis = Math.min(ziel, gezeigt + PRO_FRAME);
        while (gezeigt < bis) {
            bauen.accept(gezeigt);
            gezeigt++;
        }
        angemeldet = false;
        if (gezeigt < ziel) anmelden();
    }
}
