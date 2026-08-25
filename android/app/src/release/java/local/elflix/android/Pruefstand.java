package local.elflix.android;

import android.content.Context;

/**
 * Der Prüfstand - im Release ein leerer Rumpf.
 *
 * <p>Die Fassung mit Inhalt liegt in {@code src/debug/java} und nimmt über
 * einen Broadcast Wiedergabewerte entgegen, um die Fortschrittsregel prüfen zu
 * können, ohne stundenlang Videos abzuspielen. In einer ausgelieferten App wäre
 * derselbe Empfänger eine Hintertür in die Ablage: wer ihn erreicht, kann
 * Fortschritt erfinden, Folgen abschließen und Einträge in die Mediathek
 * schieben.
 *
 * <p>Deshalb genau diese Aufteilung. Es fehlt nicht nur der Schalter, es fehlt
 * der Code: {@code src/release/AndroidManifest.xml} trägt keinen Empfänger ein,
 * und was hier steht, tut nichts. {@link #aktiv()} sagt es an einer Stelle
 * ausdrücklich, damit ein Aufrufer sich nicht darauf verlassen muss, dass er
 * die Variante kennt.
 *
 * <p>Die Signaturen sind mit der Debug-Fassung identisch - {@code MainActivity}
 * übersetzt gegen beide, ohne von Varianten zu wissen.
 */
public final class Pruefstand {
    private Pruefstand() {
    }

    /** Ob es den Prüfstand in dieser Variante gibt. Hier: nein. */
    public static boolean aktiv() {
        return false;
    }

    public static void einrichten(Context context, Pruefumgebung umgebung) {
        // Nichts. Siehe Klassenkommentar.
    }

    public static void abbauen(Context context, Pruefumgebung umgebung) {
        // Nichts. Siehe Klassenkommentar.
    }
}
