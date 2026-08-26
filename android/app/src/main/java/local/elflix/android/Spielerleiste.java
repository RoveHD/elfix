package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Die Wiedergabeleiste: "Naechste Folge" und der Autoplay-Schalter.
 *
 * <h2>Warum es sie gibt</h2>
 *
 * <p>Am Rechner stehen beide Bedienelemente <em>in</em> der Anbieterseite -
 * dort muessen sie hin, weil deren Fenster im Vollbild alles zudeckt (siehe
 * {@code installNextEpisodePrompt} in main.js). Auf Android liegt das Vollbild
 * dagegen in einem eigenen Rahmen auf der Fensterdekoration, und in den laesst
 * sich eine Ansicht haengen. Das ist der bessere Ort: kein Skript in einer
 * fremden Seite, kein Rueckkanal ueber die Konsole, und auf dem Fernseher ein
 * Knopf, den die Fernbedienung wirklich erreichen kann.
 *
 * <h2>Wo sie liegt</h2>
 *
 * <p>Zwei Plaetze, wie beim {@link Livestreifen}:
 *
 * <ul>
 *   <li><b>Neben dem Bild.</b> Ausserhalb des Vollbilds haengt sie in ihrem
 *       eigenen Streifen ueber der Seite und verdeckt nichts.
 *   <li><b>Im Vollbild.</b> Dort zieht sie in den Vollbildrahmen um - unten
 *       rechts, <em>ueber</em> der Bedienleiste des Hosters und nicht auf ihr.
 *       Sie kommt und geht mit den Bedienelementen des Players, genau wie der
 *       Livestreifen: ein Knopf, der dauerhaft auf dem Video klebt, verdeckt
 *       irgendwann das, was man sehen will.
 * </ul>
 *
 * <h2>Was sie nicht tut</h2>
 *
 * <p>Rechnen. Ob es eine naechste Folge gibt und welche, entscheidet
 * {@link Folgen} ueber den geteilten Kern; hier wird nur angezeigt, was von
 * dort kommt. Gibt es keine, verschwindet der Knopf - eine Serie hat ein Ende,
 * und ein Knopf ins Leere waere schlimmer als keiner.
 */
final class Spielerleiste {

    /** Was die Leiste von der Oberflaeche braucht. */
    interface Umgebung {
        boolean fernseher();

        /** Der Knopf wurde gedrueckt. */
        void naechsteFolge();

        /** Der Schalter wurde umgelegt. */
        void autoplaySetzen(boolean an);

        /** Wie der Schalter gerade steht. */
        boolean autoplayAn();
    }

    /** Derselbe Rueckfall wie beim Livestreifen: ohne Meldung des Players nach kurzer Ruhe weg. */
    private static final long RUECKFALL_RUHE_MS = 3500;

    private final Context context;
    private final Umgebung umgebung;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    private final LinearLayout wurzel;
    private final TextView knopfNaechste;
    private final TextView knopfAutoplay;

    /** Wo die Leiste im Normalbetrieb haengt. */
    private ViewGroup zuhause;

    /** Die Adresse der naechsten Folge - leer heisst: es gibt keine. */
    private String ziel = "";
    /** Ob ueberhaupt gerade vor einer Folge gesessen wird. */
    private boolean amSchauen;
    private boolean imVollbild;
    private boolean steuerungAn = true;
    private boolean gemeldetAn = true;
    private boolean steuerungGemeldet;

    private final Runnable rueckfallVerbergen = new Runnable() {
        @Override
        public void run() {
            // Ein Knopf, der unter dem Fokus verschwindet, nimmt der
            // Fernbedienung den Platz, an dem sie steht - danach landet der
            // Fokus irgendwo. Solange er gehalten wird, bleibt die Leiste.
            if (wurzel.hasFocus()) {
                haupt.postDelayed(this, RUECKFALL_RUHE_MS);
                return;
            }
            boolean sollAn = steuerungGemeldet && gemeldetAn;
            if (steuerungAn == sollAn) return;
            steuerungAn = sollAn;
            anwenden();
        }
    };

    Spielerleiste(Context context, Umgebung umgebung) {
        this.context = context;
        this.umgebung = umgebung;
        boolean tv = umgebung.fernseher();

        wurzel = new LinearLayout(context);
        wurzel.setOrientation(LinearLayout.HORIZONTAL);
        wurzel.setGravity(Gravity.CENTER_VERTICAL | Gravity.END);
        wurzel.setClipChildren(false);
        wurzel.setClipToPadding(false);
        wurzel.setVisibility(View.GONE);

        knopfNaechste = tv
            ? TvViews.hauptPillButton(context, "Nächste Folge  ›", this::naechsteGedrueckt)
            : MobileViews.primaryButton(context, "Nächste Folge  ›", this::naechsteGedrueckt);
        knopfAutoplay = tv
            ? TvViews.pillButton(context, autoplayText(), this::autoplayGedrueckt)
            : MobileViews.secondaryButton(context, autoplayText(), this::autoplayGedrueckt);

        wurzel.addView(knopfAutoplay, knopfMass(tv));
        LinearLayout.LayoutParams naechsteMass = knopfMass(tv);
        naechsteMass.leftMargin = dp(8);
        wurzel.addView(knopfNaechste, naechsteMass);
        aussehenAnwenden();
    }

    private LinearLayout.LayoutParams knopfMass(boolean tv) {
        return new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            tv ? ViewGroup.LayoutParams.WRAP_CONTENT : dp(MobileViews.TOUCH_TARGET));
    }

    View ansicht() {
        return wurzel;
    }

    void setzeZuhause(ViewGroup halter) {
        zuhause = halter;
    }

    /* ------------------------------------------------------- Was dasteht */

    /** Ob gerade ueberhaupt eine Folge offen ist. */
    void setzeAmSchauen(boolean an) {
        if (amSchauen == an) return;
        amSchauen = an;
        anwenden();
    }

    /**
     * Die naechste Folge - oder leer, wenn es keine gibt.
     *
     * <p>Der Knopf verschwindet dann; der Schalter bleibt, denn eine
     * Einstellung gilt auch fuer die naechste Serie.
     */
    void setzeZiel(String url) {
        String neu = url == null ? "" : url;
        if (neu.equals(ziel)) return;
        ziel = neu;
        boolean weg = ziel.isEmpty();
        // Verschwindet der Knopf, waehrend er den Fokus haelt, faellt der Fokus
        // ins Nichts und die Fernbedienung steht irgendwo. Er wird
        // weitergereicht, bevor der Knopf geht.
        if (weg && knopfNaechste.hasFocus()) knopfAutoplay.requestFocus();
        knopfNaechste.setVisibility(weg ? View.GONE : View.VISIBLE);
        anwenden();
    }

    /** Den Schalter nachziehen - nach dem Umlegen und beim Aufbau. */
    void autoplayAuffrischen() {
        knopfAutoplay.setText(autoplayText());
    }

    private String autoplayText() {
        return umgebung.autoplayAn() ? "Autoplay: An" : "Autoplay: Aus";
    }

    private void naechsteGedrueckt() {
        regung();
        umgebung.naechsteFolge();
    }

    private void autoplayGedrueckt() {
        regung();
        umgebung.autoplaySetzen(!umgebung.autoplayAn());
        autoplayAuffrischen();
    }

    /* ------------------------------------- Im Vollbild: mit der Steuerung */

    /** Ein neuer Player - was der alte ueber seine Leiste gesagt hat, gilt nicht mehr. */
    void playerNeu() {
        steuerungGemeldet = false;
        gemeldetAn = true;
        steuerungAn = true;
        haupt.removeCallbacks(rueckfallVerbergen);
        if (imVollbild) haupt.postDelayed(rueckfallVerbergen, RUECKFALL_RUHE_MS);
        anwenden();
    }

    /** Der Player sagt, ob seine Bedienelemente zu sehen sind. */
    void steuerungSichtbar(boolean an) {
        steuerungGemeldet = true;
        gemeldetAn = an;
        haupt.removeCallbacks(rueckfallVerbergen);
        if (steuerungAn == an) return;
        steuerungAn = an;
        anwenden();
    }

    /** Jemand hat etwas getan - Beruehrung, D-Pad, Fernbedienung. */
    void regung() {
        haupt.removeCallbacks(rueckfallVerbergen);
        haupt.postDelayed(rueckfallVerbergen, RUECKFALL_RUHE_MS);
        if (steuerungAn) return;
        steuerungAn = true;
        anwenden();
    }

    /**
     * Die Regel selbst - ohne Ansicht, damit sie sich pruefen laesst.
     *
     * <p>Ausserhalb des Vollbilds steht die Leiste neben dem Bild und verdeckt
     * nichts; dort haengt sie allein daran, ob ueberhaupt eine Folge offen ist.
     * Im Vollbild liegt sie auf dem Video - und dort gilt, was der Player ueber
     * seine eigenen Bedienelemente sagt.
     */
    static boolean zeigen(boolean amSchauen, boolean imVollbild, boolean steuerungAn) {
        return amSchauen && (!imVollbild || steuerungAn);
    }

    private void anwenden() {
        wurzel.setVisibility(zeigen(amSchauen, imVollbild, steuerungAn) ? View.VISIBLE : View.GONE);
    }

    /* ------------------------------------------------------- Der Umzug */

    /**
     * Ins Vollbild und zurueck.
     *
     * <p>Unten rechts und mit Abstand nach unten: die Bedienleiste des Hosters
     * liegt am unteren Rand ueber die ganze Breite. Eine Leiste, die dort
     * klebte, naehme genau die Knoepfe weg, die man beim Schauen braucht -
     * Play, Spulen, Lautstaerke, Vollbild.
     */
    void inVollbild(FrameLayout rahmen) {
        if (wurzel.getParent() instanceof ViewGroup) {
            ((ViewGroup) wurzel.getParent()).removeView(wurzel);
        }
        imVollbild = rahmen != null;
        aussehenAnwenden();
        // Beim Eintreten erst einmal da - die Bedienelemente des Players sind
        // in diesem Augenblick fast immer offen. Was danach gilt, sagt der
        // Player.
        steuerungAn = true;
        haupt.removeCallbacks(rueckfallVerbergen);
        if (imVollbild) haupt.postDelayed(rueckfallVerbergen, RUECKFALL_RUHE_MS);
        anwenden();
        if (rahmen != null) {
            boolean tv = umgebung.fernseher();
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.gravity = Gravity.BOTTOM | Gravity.END;
            params.rightMargin = dp(tv ? TvViews.SCREEN_PADDING : 12);
            // Ueber der Bedienleiste des Hosters, nicht auf ihr.
            params.bottomMargin = dp(tv ? 96 : 64);
            rahmen.addView(wurzel, params);
            wurzel.bringToFront();
            return;
        }
        if (zuhause != null) {
            zuhause.addView(wurzel, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }

    /**
     * Das Aussehen haengt am Platz.
     *
     * <p>Neben dem Bild ist die Leiste ein Streifen ueber die ganze Breite und
     * traegt den Hintergrund der Oberflaeche. Im Vollbild ist sie ein kleiner,
     * deckender Kasten auf dem Video - durchscheinend waere sie ueber
     * wechselnden Bildern genau dann unlesbar, wenn man sie braucht.
     */
    private void aussehenAnwenden() {
        boolean tv = umgebung.fernseher();
        int rand = dp(tv ? 12 : 8);
        wurzel.setPadding(rand, rand, rand, rand);
        if (imVollbild) {
            wurzel.setBackground(MobileViews.shape(context,
                Color.parseColor("#EC0B1220"), tv ? 18 : 14, Theme.BORDER, 1));
        } else {
            wurzel.setBackground(null);
            wurzel.setBackgroundColor(Theme.SURFACE);
        }
    }

    /* ------------------------------------------------- Die Fernbedienung */

    /**
     * Den Fokus auf die Leiste holen.
     *
     * <p>Der einzige Weg dorthin, solange das Video den Fokus hat. Kostet
     * nichts, wo nichts steht: eine unsichtbare Leiste nimmt den Fokus gar
     * nicht erst an.
     *
     * @return ob der Fokus wirklich dort angekommen ist
     */
    boolean fokussieren() {
        if (wurzel.getVisibility() != View.VISIBLE) return false;
        regung();
        if (knopfNaechste.getVisibility() == View.VISIBLE && knopfNaechste.requestFocus()) return true;
        return knopfAutoplay.requestFocus();
    }

    boolean hatFokus() {
        return wurzel.getVisibility() == View.VISIBLE && wurzel.hasFocus();
    }

    private int dp(int wert) {
        return Math.round(wert * context.getResources().getDisplayMetrics().density);
    }
}
