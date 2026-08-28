package local.elflix.android;

import android.app.Activity;
import android.content.Context;
import android.graphics.PorterDuff;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/**
 * Der Vorhang, hinter dem eine Folge startet.
 *
 * <h2>Was er verbirgt</h2>
 *
 * <p>Zwischen dem Tipp auf "Weiterschauen" und dem laufenden Video liegen
 * Dinge, die niemand sehen will: der Aufbau der Anbieterseite, ihre
 * Hosterliste, die Ueberlagerung des Players mit dem Spielen-Knopf, das
 * Umschalten ins Vollbild. Am Rechner liegt darum seit jeher ein Vorhang
 * davor ({@code showAutostartCurtain} in main.js) - auf Android sah man alles.
 *
 * <p>Er liegt auf der <b>Fensterdekoration</b> und nicht in {@code content}.
 * Das ist kein Geschmack, sondern Notwendigkeit: das Vollbild haengt sich
 * ebenfalls dorthin ({@code onShowCustomView}), und ein Vorhang in der
 * Oberflaeche darunter waere ausgerechnet in dem Augenblick weg, in dem der
 * Wechsel ins Vollbild zu verbergen ist. Nach jedem Umbau wird er ueber
 * {@link #hebe()} wieder nach oben geholt.
 *
 * <h2>Warum der Balken nicht luegt</h2>
 *
 * <p>Er zaehlt keine Zeit hoch. Jeder Sprung entspricht einem Schritt, den die
 * Startkette wirklich hinter sich hat - die Seite steht, der Player ist da,
 * die Quelle ist geladen, der Stand ist gesetzt, das Vollbild sitzt. Welche
 * Schritte es gibt, wie sie heissen und wie voll der Balken dabei ist, sagt
 * {@link Startphasen} und damit das geteilte Modul; hier wird nur gezeichnet.
 *
 * <p>Rueckwaerts geht der Balken nie: die Kette meldet manche Schritte
 * mehrfach, und ein zurueckspringender Balken sieht aus wie ein Fehler.
 *
 * <h2>Warum er nichts durchlaesst</h2>
 *
 * <p>Solange er liegt, gehoeren ihm Finger und Fernbedienung. Er ist
 * anklickbar und fokussierbar und schluckt jede Taste ausser "Zurueck" -
 * sonst tastet sich die Fernbedienung durch Ziele, die man gar nicht sieht,
 * und ein Tipp landet auf der Anbieterseite dahinter. Genau das ist auf dem
 * Fernseher der Unterschied zwischen einem Ladebildschirm und einem
 * Ladebildschirm, in dem man sich verirren kann.
 *
 * <h2>Und wenn nichts kommt</h2>
 *
 * <p>Dann bleibt er nicht ewig liegen. Jeder Schritt hat seine Frist, und
 * ueber allem steht ein Deckel; beide stehen im geteilten Modul. Laeuft eine
 * ab, wird aus dem Ladebildschirm eine Ansage mit zwei Wegen: "Erneut
 * versuchen" und "Zurueck". Der erste Knopf bekommt den Fokus, damit auf dem
 * Fernseher ein Druck auf OK reicht.
 */
final class Startvorhang {
    private static final String TAG = CrashReporter.TAG;

    /** Wie oft nachgesehen wird, ob eine Frist abgelaufen ist. */
    private static final long TAKT_MS = 250L;

    /** Der Balken rechnet in Tausendsteln - Prozente sind zu grob fuer weiche Schritte. */
    private static final int BALKEN_MAX = 1000;

    /** Was der Vorhang von der Oberflaeche braucht. */
    interface Umgebung {
        /** "Erneut versuchen" - denselben Start noch einmal von vorn. */
        void erneutVersuchen();

        /** "Zurueck" - den Start aufgeben und dorthin, wo man herkam. */
        void aufgeben(String grund);

        /** Ob dieses Geraet ein Fernseher ist. Entscheidet nur ueber die Knopfform. */
        boolean fernseher();
    }

    private final Activity activity;
    private final Startphasen phasen;
    private final Umgebung umgebung;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    private FrameLayout wurzel;
    private LinearLayout ladeKasten;
    private LinearLayout fehlerKasten;
    private TextView titelZeile;
    private TextView phasenZeile;
    private ProgressBar balken;
    private TextView fehlerZeile;
    private View knopfErneut;

    /** Der laufende Start, oder leer. */
    private String phase = "";
    private String titel = "";
    private double stelle;
    private long begonnenAt;
    private long phaseSeit;
    private boolean liegt;

    private final Runnable takt = this::taktSchlag;

    Startvorhang(Activity activity, Startphasen phasen, Umgebung umgebung) {
        this.activity = activity;
        this.phasen = phasen;
        this.umgebung = umgebung;
    }

    /* ------------------------------------------------------------ Der Ablauf */

    /**
     * Den Vorhang zuziehen und den Start beginnen.
     *
     * <p>Ohne geladene Phasentabelle geschieht nichts und wird {@code false}
     * gemeldet: dann laeuft auch die Startkette selbst nicht ueber den Kern,
     * und ein Vorhang ohne jemanden, der ihn wieder aufzieht, waere das
     * schlimmere Uebel. Der Aufrufer startet in diesem Fall wie bisher.
     *
     * @param titel  was gestartet wird, in Worten. Steht gross im Bild.
     * @param stelle der gespeicherte Stand in Sekunden, 0 fuer "von vorn"
     * @return ob der Vorhang wirklich liegt
     */
    boolean starten(String titel, double stelle) {
        if (phasen == null || !phasen.istBereit()) {
            Log.i(TAG, "Startvorhang entfaellt - keine Phasentabelle");
            return false;
        }
        this.titel = titel == null ? "" : titel;
        this.stelle = Math.max(0, stelle);
        this.begonnenAt = SystemClock.uptimeMillis();
        this.phaseSeit = this.begonnenAt;
        // Erst bauen, dann die Phase setzen. Andersherum war es falsch, und
        // zwar lautlos: bauen() raeumt ueber abbauen() einen etwaigen alten
        // Vorhang ab, und dazu gehoert der Phasenname. Der erste Anblick war
        // deshalb ein leerer Balken ohne Beschriftung - zu sehen nur, solange
        // die Seite laedt, denn die naechste Meldung setzte beides wieder
        // richtig. Gemessen am 26.08.2026 im Handy-Emulator ("Erneut
        // versuchen" auf einer langsamen Verbindung).
        bauen();
        this.phase = phasen.erste();
        zeichnen();
        haupt.removeCallbacks(takt);
        haupt.postDelayed(takt, TAKT_MS);
        Log.i(TAG, "Startvorhang zu: " + this.titel
            + (this.stelle > 0 ? " ab " + Math.round(this.stelle) + "s" : " von vorn"));
        return true;
    }

    /** Ob gerade ein Start begleitet wird. */
    boolean laeuft() {
        return liegt;
    }

    /** In welchem Schritt der Start steht. Leer, wenn keiner laeuft. */
    String phase() {
        return liegt ? phase : "";
    }

    /**
     * Einen Schritt melden.
     *
     * <p>Nach vorn oder gar nicht. Ist der letzte Schritt erreicht, geht der
     * Vorhang auf - und keinen Augenblick frueher.
     */
    void melden(String name) {
        if (!liegt || name == null || name.isEmpty()) return;
        int ziel = phasen.nummer(name);
        if (ziel < 0 || ziel <= phasen.nummer(phase)) return;
        phase = name;
        phaseSeit = SystemClock.uptimeMillis();
        Log.i(TAG, "Startvorhang Phase " + phase + " ("
            + Math.round(phasen.anteil(phase) * 100) + "%)");
        if (phase.equals(phasen.letzte())) {
            // Das Video laeuft und das Vollbild sitzt. Erst jetzt.
            auf("fertig");
            return;
        }
        zeichnen();
    }

    /**
     * Den Vorhang aufziehen, ohne dass der Start fertig geworden waere.
     *
     * <p>Fuer alles, was den Start gegenstandslos macht: eine andere Folge,
     * das Verlassen der Ansicht, ein Abbruch der Kette.
     */
    void auf(String grund) {
        if (!liegt) return;
        long dauer = SystemClock.uptimeMillis() - begonnenAt;
        Log.i(TAG, "Startvorhang auf nach " + (dauer / 100) / 10.0 + "s (" + grund + ")");
        haupt.removeCallbacks(takt);
        abbauen();
    }

    /** Der Start ist gescheitert - die Ansage statt des Balkens. */
    void fehler(String grund) {
        if (!liegt) return;
        haupt.removeCallbacks(takt);
        String text = phasen.fehlertext(grund);
        Log.w(TAG, "Startvorhang Fehler (" + grund + "): " + text);
        fehlerZeile.setText(text);
        ladeKasten.setVisibility(View.GONE);
        fehlerKasten.setVisibility(View.VISIBLE);
        knopfErneut.requestFocus();
    }

    /**
     * Den Vorhang wieder nach oben holen.
     *
     * <p>Zu rufen, nachdem etwas anderes an die Fensterdekoration gehaengt
     * wurde - im Wesentlichen der Vollbildrahmen. Ohne das liegt der Vorhang
     * darunter, und genau der Wechsel ins Vollbild waere zu sehen.
     */
    void hebe() {
        if (!liegt || wurzel == null) return;
        wurzel.bringToFront();
        wurzel.requestLayout();
    }

    /**
     * Ob Tasten an das durchgereicht werden duerfen, was der Vorhang zeigt.
     *
     * <p>Waehrend geladen wird: nein. Es gibt nichts anzuwaehlen, und jede
     * Taste ginge an die Seite dahinter. Steht die Fehleransage: ja - dann
     * gehoeren dem Zuschauer zwei Knoepfe, und zwischen denen muss er wechseln
     * koennen.
     */
    boolean tastenErlaubt() {
        return liegt && fehlerKasten != null && fehlerKasten.getVisibility() == View.VISIBLE;
    }

    /**
     * Die Zurueck-Taste, solange der Vorhang liegt.
     *
     * @return ob sie verbraucht wurde
     */
    boolean zurueckTaste() {
        if (!liegt) return false;
        if (fehlerKasten != null && fehlerKasten.getVisibility() == View.VISIBLE) {
            umgebung.aufgeben("zurueck im Fehler");
            return true;
        }
        umgebung.aufgeben("abgebrochen");
        return true;
    }

    /* ----------------------------------------------------------- Das Bild */

    private void taktSchlag() {
        if (!liegt) return;
        String grund = abgelaufen(phasen, phase, begonnenAt, phaseSeit, SystemClock.uptimeMillis());
        if (!grund.isEmpty()) {
            fehler(grund);
            return;
        }
        haupt.postDelayed(takt, TAKT_MS);
    }

    /**
     * Ist eine Frist abgelaufen - und welche?
     *
     * <p>Rein und ohne Ansicht, damit es sich ohne Geraet pruefen laesst. Die
     * Zahlen kommen aus dem geteilten Modul; hier steht nur die Subtraktion.
     *
     * <p>Der Deckel geht vor: er beantwortet die Frage "wie lange sitze ich
     * schon vor diesem Bildschirm", und die ist dem Zuschauer naeher als die,
     * welcher Schritt gerade klemmt.
     *
     * @return der Grund fuer die Fehleransage, oder leer, solange gewartet wird
     */
    static String abgelaufen(Startphasen phasen, String phase, long begonnenAt, long phaseSeit,
            long jetzt) {
        if (phasen == null) return "";
        long deckel = phasen.gesamtFristMs();
        if (deckel > 0 && jetzt - begonnenAt >= deckel) return "gesamt";
        Startphasen.Phase aktuell = phasen.phase(phase);
        if (aktuell != null && aktuell.fristMs > 0 && jetzt - phaseSeit >= aktuell.fristMs) {
            return phase;
        }
        return "";
    }

    private void zeichnen() {
        if (!liegt) return;
        titelZeile.setText(titel.isEmpty() ? "Wiedergabe" : titel);
        String text = phasen.beschriftung(phase);
        phasenZeile.setText(stelle > 0 && "stelle".equals(phase)
            ? text + " (" + zeitText(stelle) + ")"
            : text);
        balken.setProgress((int) Math.round(phasen.anteil(phase) * BALKEN_MAX));
    }

    /** Sekunden als 1:02:03 beziehungsweise 2:03 - nur fuer die Anzeige. */
    static String zeitText(double sekunden) {
        long gesamt = Math.max(0, Math.round(sekunden));
        long s = gesamt % 60;
        long m = (gesamt / 60) % 60;
        long h = gesamt / 3600;
        if (h > 0) return String.format(java.util.Locale.GERMANY, "%d:%02d:%02d", h, m, s);
        return String.format(java.util.Locale.GERMANY, "%d:%02d", m, s);
    }

    private void bauen() {
        abbauen();
        boolean tv = umgebung.fernseher();
        Context context = activity;

        wurzel = new FrameLayout(context);
        wurzel.setBackgroundColor(Theme.BACKGROUND);
        // Er gehoert ihm: kein Tipp und keine Taste geht an das, was dahinter
        // liegt. Ohne das tastet sich die Fernbedienung durch unsichtbare Ziele.
        wurzel.setClickable(true);
        wurzel.setFocusable(true);
        wurzel.setFocusableInTouchMode(true);
        wurzel.setOnKeyListener((ansicht, code, ereignis) -> {
            if (code == KeyEvent.KEYCODE_BACK) return false;
            return fehlerKasten == null || fehlerKasten.getVisibility() != View.VISIBLE;
        });

        LinearLayout mitte = new LinearLayout(context);
        mitte.setOrientation(LinearLayout.VERTICAL);
        mitte.setGravity(Gravity.CENTER_HORIZONTAL);
        int rand = dp(tv ? 64 : 28);
        mitte.setPadding(rand, 0, rand, 0);

        titelZeile = new TextView(context);
        titelZeile.setTextColor(Theme.TEXT_PRIMARY);
        titelZeile.setTextSize(tv ? 30 : 22);
        titelZeile.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        titelZeile.setGravity(Gravity.CENTER);
        titelZeile.setMaxLines(2);
        mitte.addView(titelZeile);

        ladeKasten = new LinearLayout(context);
        ladeKasten.setOrientation(LinearLayout.VERTICAL);
        ladeKasten.setGravity(Gravity.CENTER_HORIZONTAL);

        balken = new ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal);
        balken.setMax(BALKEN_MAX);
        balken.setIndeterminate(false);
        balken.getProgressDrawable().setColorFilter(Theme.PRIMARY, PorterDuff.Mode.SRC_IN);
        LinearLayout.LayoutParams balkenMass = new LinearLayout.LayoutParams(
            tv ? dp(560) : ViewGroup.LayoutParams.MATCH_PARENT, dp(6));
        balkenMass.topMargin = dp(22);
        ladeKasten.addView(balken, balkenMass);

        phasenZeile = new TextView(context);
        phasenZeile.setTextColor(Theme.TEXT_SECONDARY);
        phasenZeile.setTextSize(tv ? 17 : 14);
        phasenZeile.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams phasenMass = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        phasenMass.topMargin = dp(14);
        ladeKasten.addView(phasenZeile, phasenMass);
        mitte.addView(ladeKasten, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        fehlerKasten = new LinearLayout(context);
        fehlerKasten.setOrientation(LinearLayout.VERTICAL);
        fehlerKasten.setGravity(Gravity.CENTER_HORIZONTAL);
        fehlerKasten.setVisibility(View.GONE);

        fehlerZeile = new TextView(context);
        fehlerZeile.setTextColor(Theme.TEXT_SECONDARY);
        fehlerZeile.setTextSize(tv ? 18 : 15);
        fehlerZeile.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams fehlerMass = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        fehlerMass.topMargin = dp(18);
        fehlerKasten.addView(fehlerZeile, fehlerMass);

        LinearLayout knoepfe = new LinearLayout(context);
        knoepfe.setOrientation(LinearLayout.HORIZONTAL);
        knoepfe.setGravity(Gravity.CENTER);
        knopfErneut = tv
            ? TvViews.hauptPillButton(context, "Erneut versuchen", this::erneutGedrueckt)
            : MobileViews.primaryButton(context, "Erneut versuchen", this::erneutGedrueckt);
        View knopfZurueck = tv
            ? TvViews.pillButton(context, "Zurück", this::zurueckGedrueckt)
            : MobileViews.secondaryButton(context, "Zurück", this::zurueckGedrueckt);
        LinearLayout.LayoutParams knopfMass = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knopfMass.rightMargin = dp(12);
        knoepfe.addView(knopfErneut, knopfMass);
        knoepfe.addView(knopfZurueck, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout.LayoutParams knoepfeMass = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        knoepfeMass.topMargin = dp(22);
        fehlerKasten.addView(knoepfe, knoepfeMass);
        mitte.addView(fehlerKasten, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        wurzel.addView(mitte, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER));

        ((ViewGroup) activity.getWindow().getDecorView()).addView(wurzel,
            new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        wurzel.bringToFront();
        wurzel.requestFocus();
        liegt = true;
    }

    private void erneutGedrueckt() {
        Log.i(TAG, "Startvorhang: erneut versuchen");
        umgebung.erneutVersuchen();
    }

    private void zurueckGedrueckt() {
        umgebung.aufgeben("zurueck gedrueckt");
    }

    private void abbauen() {
        haupt.removeCallbacks(takt);
        liegt = false;
        phase = "";
        // Der Vorhang geht auf, er wird nicht weggerissen.
        //
        // Dahinter laeuft das Video bereits - das war die Bedingung dafuer,
        // ueberhaupt hierher zu kommen. Ihn in einem Bild zu entfernen war
        // deshalb der einzige harte Schnitt, den der ganze Start noch hatte:
        // Ladebild, und im naechsten Bild Film. Jetzt wird er blass und
        // zugleich ein Stueck groesser, sodass das Bild dahinter aus ihm
        // heraus aufgeht.
        //
        // Der Zustand ist vorher schon umgestellt: liegt steht auf false, und
        // die Ansicht nimmt weder Tasten noch Beruehrungen mehr an. Was hier
        // noch laeuft, ist reine Anzeige - keine Entscheidung haengt daran.
        final View alt = wurzel;
        if (alt != null && alt.getParent() instanceof ViewGroup) {
            alt.setOnKeyListener(null);
            alt.setFocusable(false);
            alt.setFocusableInTouchMode(false);
            alt.setClickable(false);
            long dauer = Bewegung.dauer(alt.getContext(), Bewegung.LANG);
            if (dauer <= 0) {
                ((ViewGroup) alt.getParent()).removeView(alt);
            } else {
                alt.animate().alpha(0f).scaleX(1.04f).scaleY(1.04f)
                    .setDuration(dauer).setInterpolator(Bewegung.hinaus()).withLayer()
                    .withEndAction(() -> {
                        if (alt.getParent() instanceof ViewGroup) {
                            ((ViewGroup) alt.getParent()).removeView(alt);
                        }
                    })
                    .start();
            }
        }
        wurzel = null;
        ladeKasten = null;
        fehlerKasten = null;
        titelZeile = null;
        phasenZeile = null;
        balken = null;
        fehlerZeile = null;
        knopfErneut = null;
    }

    private int dp(int wert) {
        return Math.round(wert * activity.getResources().getDisplayMetrics().density);
    }
}
