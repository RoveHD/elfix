package local.elflix.android;

import android.content.Context;
import android.view.FocusFinder;
import android.view.View;
import android.view.ViewGroup;
import android.widget.HorizontalScrollView;

import java.util.ArrayList;

/**
 * Eine waagerechte Reihe, die den Fokus nicht verliert.
 *
 * <p>Sonst ein gewoehnlicher Schieber - der Unterschied steht in
 * {@link #focusSearch(View, int)} und hat zwei Haelften. Links und rechts
 * suchen nur noch innerhalb dieser Reihe; findet sich dort nichts mehr, bleibt
 * der Fokus stehen, statt in die Nachbarreihe zu springen. Oben und unten
 * gehen weiter wie bisher, nur landen sie in der Nachbarreihe dort, wo man
 * gerade steht, und nicht an deren Anfang.
 *
 * <p>Warum hier und nicht in einem Tastendruck-Horcher an jeder Kachel: eine
 * Reihe legt ihre Kacheln erst nach, wenn der Fokus in die Naehe kommt (siehe
 * {@code TvNachladung}). Ein Horcher je Kachel muesste wissen, ob er der
 * letzten gehoert - und die letzte wechselt. Der Reihe selbst ist das
 * gleichgueltig: sie fragt im Augenblick des Tastendrucks ihre eigenen Kinder.
 *
 * <p>Die Rechnung dahinter steht in {@link Reihenfokus} und ist dort ohne
 * Fernseher geprueft.
 */
final class Fokusreihe extends HorizontalScrollView {

    /** Ob die Reihe beim Wechsel nach oben oder unten die Spalte haelt. */
    private final boolean spalteHalten;

    Fokusreihe(Context context) {
        this(context, true);
    }

    /**
     * @param spalteHalten fuer Kachelreihen {@code true}. Die Knopfleiste der
     *                     Kopfzeile sagt hier {@code false}: sie steht rechts
     *                     ausgerichtet, und unter ihrem letzten Knopf liegt
     *                     nicht der Anfang der Seite, sondern deren rechter
     *                     Rand. Wer von "Einstellungen" nach unten drueckt,
     *                     will in die Seite - nicht an deren Kante.
     */
    Fokusreihe(Context context, boolean spalteHalten) {
        super(context);
        this.spalteHalten = spalteHalten;
    }

    @Override
    public View focusSearch(View fokus, int richtung) {
        if (fokus == null) return super.focusSearch(fokus, richtung);
        if (richtung == FOCUS_LEFT || richtung == FOCUS_RIGHT) {
            View ziel = FocusFinder.getInstance().findNextFocus(this, fokus, richtung);
            // Kein Ziel in dieser Reihe heisst: hier ist Ende. Den eigenen
            // Fokus zurueckzugeben haelt ihn stehen - gaeben wir null zurueck,
            // suchte der Rahmen weiter und faende die Reihe darunter.
            return ziel != null ? ziel : fokus;
        }
        View ziel = super.focusSearch(fokus, richtung);
        if (!spalteHalten || (richtung != FOCUS_UP && richtung != FOCUS_DOWN)) return ziel;
        Fokusreihe nachbar = reiheVon(ziel);
        if (nachbar == null || nachbar == this) return ziel;
        View spalte = nachbar.spalteBei(mitteVon(fokus));
        return spalte != null ? spalte : ziel;
    }

    /** Die Reihe, in der dieses Ziel liegt - oder null, wenn es keine ist. */
    private static Fokusreihe reiheVon(View ziel) {
        View lauf = ziel;
        while (lauf != null) {
            if (lauf instanceof Fokusreihe) return (Fokusreihe) lauf;
            Object eltern = lauf.getParent();
            lauf = eltern instanceof View ? (View) eltern : null;
        }
        return null;
    }

    /** Die Mitte einer Ansicht auf dem Bildschirm - nicht in ihrer Reihe. */
    private static int mitteVon(View ansicht) {
        int[] stelle = new int[2];
        ansicht.getLocationOnScreen(stelle);
        return stelle[0] + ansicht.getWidth() / 2;
    }

    /**
     * Das Fokusziel dieser Reihe, das einer Bildschirmmitte am naechsten liegt.
     *
     * <p>Gezaehlt werden die Kinder der Leiste und nicht die Fokusziele
     * darunter: eine Karte kann ihren Knopf tragen (so die Rueckblickskarte),
     * und gemeint ist trotzdem die Karte als Ganze.
     */
    private View spalteBei(int mitte) {
        View kind = getChildCount() > 0 ? getChildAt(0) : null;
        if (!(kind instanceof ViewGroup)) return null;
        ViewGroup leiste = (ViewGroup) kind;
        ArrayList<View> ziele = new ArrayList<>();
        ArrayList<Integer> mitten = new ArrayList<>();
        for (int i = 0; i < leiste.getChildCount(); i += 1) {
            View kachel = leiste.getChildAt(i);
            if (kachel.getVisibility() != VISIBLE || kachel.getWidth() == 0) continue;
            View ziel = fokusZiel(kachel);
            if (ziel == null) continue;
            ziele.add(ziel);
            mitten.add(mitteVon(kachel));
        }
        int[] werte = new int[mitten.size()];
        for (int i = 0; i < werte.length; i += 1) werte[i] = mitten.get(i);
        int stelle = Reihenfokus.spalteBei(werte, mitte);
        return stelle == Reihenfokus.KEINES ? null : ziele.get(stelle);
    }

    /** Die Kachel selbst, wenn sie den Fokus nimmt - sonst das erste Ziel darin. */
    private static View fokusZiel(View kachel) {
        if (kachel.isFocusable() && kachel.isEnabled()) return kachel;
        ArrayList<View> treffer = new ArrayList<>();
        kachel.addFocusables(treffer, FOCUS_DOWN, FOCUSABLES_ALL);
        return treffer.isEmpty() ? null : treffer.get(0);
    }
}
