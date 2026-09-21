package local.elflix.android;

import java.util.ArrayDeque;
import java.util.function.BiPredicate;

/**
 * Haelt vollstaendige Bestandsmutationen in der Reihenfolge ihrer Messung.
 *
 * <p>Jeder Fortschrittsaufruf nimmt die ganze Favoritenliste mit und gibt eine
 * neue ganze Liste zurueck. Laufen zwei davon gleichzeitig, kann die spaetere
 * Antwort deshalb auf einem aelteren Stand gerechnet sein und die schon
 * verbuchte Folge wieder zuruecksetzen. Diese kleine Reihe laesst immer nur
 * den Kopf laufen. Mehrere noch wartende Messungen derselben Folge duerfen auf
 * den neuesten Stand zusammenfallen; ein Folgenwechsel bleibt eine eigene
 * Position in der Reihe.
 */
final class FortschrittReihe<T> {
    private final ArrayDeque<T> wartend = new ArrayDeque<>();
    private boolean laeuft;

    void hinzufuegen(T wert, BiPredicate<T, T> ersetzbar) {
        int nichtLaufend = wartend.size() - (laeuft ? 1 : 0);
        T letzter = nichtLaufend > 0 ? wartend.peekLast() : null;
        if (letzter != null && ersetzbar.test(letzter, wert)) {
            wartend.removeLast();
        }
        wartend.addLast(wert);
    }

    T beginnen() {
        if (laeuft || wartend.isEmpty()) return null;
        laeuft = true;
        return wartend.peekFirst();
    }

    T aktuell() {
        return laeuft ? wartend.peekFirst() : null;
    }

    void abschliessen() {
        if (!laeuft) return;
        wartend.removeFirst();
        laeuft = false;
    }

    /** Gibt den laufenden Kopf fuer einen spaeteren erneuten Beginn frei. */
    void anhalten() {
        laeuft = false;
    }

    int groesse() {
        return wartend.size();
    }
}
