package local.elflix.android;

import android.util.Log;
import android.webkit.WebView;

/**
 * Immer die beste Bildstufe beim Hoster.
 *
 * <p>VOE laesst den Player auf "Auto" stehen. Auto waehlt nach Leitung und
 * Puffer und liegt dabei gern eine Stufe unter dem, was moeglich waere - einmal
 * heruntergeregelt, kommt es von selbst oft nicht wieder hoch. Auf einem
 * Fernseher faellt das sofort auf.
 *
 * <p>Gesetzt wird einmal je Folge, nicht dauernd: wer waehrend des Schauens von
 * Hand heruntergeht, hat einen Grund dafuer, und ein Skript, das ihn sofort
 * wieder hochdreht, waere eine Bevormundung. Die Regel dazu steht in
 * {@code voe-qualitaet.js}, dieselbe wie am Rechner - hier steht nur, dass das
 * Skript in den Rahmen kommt, in dem der Player wirklich liegt.
 */
public final class Qualitaet {
    private static final String TAG = CrashReporter.TAG;

    private final Kern kern;
    private final Rahmen rahmen;
    private String skript;

    public Qualitaet(Kern kern, Rahmen rahmen) {
        this.kern = kern;
        this.rahmen = rahmen;
    }

    /** Das Skript einmalig holen; es haengt von nichts ab und aendert sich nie. */
    public void vorbereiten() {
        if (kern == null) return;
        kern.wennBereit(() -> kern.rufe("voe-qualitaet.qualitaetScript", (wert, fehler) -> {
            if (fehler != null) {
                Log.e(TAG, "Qualitaetsskript nicht erhalten: " + fehler);
                return;
            }
            skript = Kern.text(wert);
        }));
    }

    /** In jeden Rahmen mit Video. Wo kein JW Player liegt, tut das Skript nichts. */
    public void einspielen(WebView ansicht) {
        if (skript == null || skript.isEmpty() || rahmen == null || ansicht == null) return;
        int erreicht = rahmen.anSpieler(ansicht, skript);
        if (erreicht > 0) Log.i(TAG, "Bildstufe gesetzt in " + erreicht + " Rahmen");
    }
}
