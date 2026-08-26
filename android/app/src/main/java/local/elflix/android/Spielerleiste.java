package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
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
 * <h2>Zwei Bedienelemente, zwei Regeln</h2>
 *
 * <p>Sie haengen ausdruecklich nicht aneinander:
 *
 * <ul>
 *   <li><b>Der Autoplay-Schalter</b> steht, solange hier ueberhaupt etwas
 *       laeuft. Eine Einstellung, die man nur in den letzten zehn Prozent
 *       einer Folge erreicht, ist keine Einstellung.
 *   <li><b>"Naechste Folge"</b> kommt erst ab neunzig Prozent dazu - dieselbe
 *       Schwelle wie am Rechner. Vorher gibt es nichts zu ueberspringen, und
 *       im Vollbild klebte sonst eine Stunde lang ein Kasten neben dem Bild.
 * </ul>
 *
 * <h2>Der Zaehler</h2>
 *
 * <p>Am Ende der Folge - und nur dort - faengt bei eingeschaltetem Autoplay ein
 * Zaehler von fuenf an, genau wie am Rechner. Er ist der Unterschied zwischen
 * "es geht weiter" und "man wurde weitergeschoben": daneben steht "Abbrechen",
 * und ein Abbruch gilt fuer diese Folge. Der Knopf bleibt danach stehen - wer
 * es sich anders ueberlegt, kommt mit einem Druck weiter.
 *
 * <p>Solange gezaehlt wird, verschwindet die Leiste nicht mit den
 * Bedienelementen des Players. Ein Zaehler, den man nicht sieht, ist keine
 * Ansage, sondern eine Ueberraschung.
 *
 * <h2>Was sie nicht tut</h2>
 *
 * <p>Rechnen. Ob es eine naechste Folge gibt und welche, entscheidet
 * {@link Folgen} ueber den geteilten Kern; hier wird nur angezeigt, was von
 * dort kommt. Gibt es keine, verschwindet der Knopf - eine Serie hat ein Ende,
 * und ein Knopf ins Leere waere schlimmer als keiner.
 */
final class Spielerleiste {
    private static final String TAG = CrashReporter.TAG;

    /** Was die Leiste von der Oberflaeche braucht. */
    interface Umgebung {
        boolean fernseher();

        /**
         * Zur naechsten Folge wechseln.
         *
         * @param vonHand ob jemand gedrueckt hat. Nur dann gehoert ein
         *                Fehlschlag gesagt - das Ende einer Serie ist keine
         *                Meldung wert, wenn niemand danach gefragt hat.
         */
        void naechsteFolge(boolean vonHand);

        /** Der Schalter wurde umgelegt. */
        void autoplaySetzen(boolean an);

        /** Wie der Schalter gerade steht. */
        boolean autoplayAn();

        /**
         * Ob der Zaehler ueberhaupt anfangen darf.
         *
         * <p>Mehr als nur der Schalter: wer gerade einem Folgenwechsel der
         * Runde folgt, hat keinen eigenen zu machen. Der Knopf bleibt in
         * diesem Fall trotzdem stehen - er ist eine Erlaubnis, kein Automat.
         */
        boolean zaehlerErlaubt();
    }

    /**
     * Wie lange die Leiste nach der letzten Regung voll dasteht.
     *
     * <p>Dieselben fuenf Sekunden, nach denen der Rechner seine Karte
     * verblassen laesst.
     */
    private static final long RUHE_MS = 5000;
    /**
     * Wie durchsichtig sie danach wird - und ausdruecklich nicht "weg".
     *
     * <p><b>Der gemeldete Fehler.</b> Hier stand {@code View.GONE}, uebernommen
     * vom {@link Livestreifen}. Der darf das: er zeigt an, wer mitschaut, und
     * das ist verzichtbar. Diese Leiste traegt den einzigen Weg zur naechsten
     * Folge - und sie verschwand im Vollbild nach dreieinhalb Sekunden und kam
     * ohne Beruehrung nie zurueck. Auf dem Telefon lief eine Folge damit bis
     * zum Ende, ohne dass je ein Knopf zu sehen war.
     *
     * <p>Dazu kam, dass ihr Ausloeser gar nicht existierte: ob die
     * Bedienelemente des Players stehen, meldet der Horcher aus
     * {@code watchparty-sync.beobachterScript()} - und {@code Mitschauen.anPlayer}
     * setzt ihn nur ein, wenn die Watchparty eingeschaltet ist. Wer allein
     * schaut, bekam also nie eine Meldung, und der Rueckfall bedeutete
     * "unsichtbar, bis jemand das Bild antippt".
     *
     * <p>Der Rechner macht es anders und richtig: seine Karte geht nach fuenf
     * Sekunden Ruhe auf {@code opacity: 0.12} - sie bleibt stehen, bleibt
     * anklickbar und ist mit einer Mausbewegung sofort wieder da. Genau das
     * steht jetzt hier. Der Wert ist hoeher als am Rechner, weil eine
     * Beruehrung kein Zeiger ist: was man nicht sieht, tippt man auch nicht an.
     */
    private static final float RUHE_DECKKRAFT = 0.4f;
    /**
     * Wie oft der Zaehler nachsieht, wie viel noch bleibt.
     *
     * <p>Feiner als eine Sekunde, damit die angezeigte Zahl nicht um bis zu
     * eine Sekunde hinter der wirklichen Restzeit herlaeuft - dieselbe
     * Aufloesung wie am Rechner.
     */
    private static final long ZAEHLER_TAKT_MS = 200;
    private static final String KNOPF_TEXT = "Nächste Folge  ›";

    private final Context context;
    private final Umgebung umgebung;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    private final LinearLayout wurzel;
    private final TextView knopfNaechste;
    private final TextView knopfAbbrechen;
    private final TextView knopfAutoplay;

    /** Wo die Leiste im Normalbetrieb haengt. */
    private ViewGroup zuhause;

    /** Die Adresse der naechsten Folge - leer heisst: es gibt keine. */
    private String ziel = "";
    /** Ob die Folge die Neunzig-Prozent-Marke hinter sich hat. */
    private boolean nahAmEnde;
    /** Ob sie durchgelaufen ist. */
    private boolean amEnde;
    /** Ob ueberhaupt gerade vor einer Folge gesessen wird. */
    private boolean amSchauen;
    /* ----------------------------------------------------- Der Zaehler */
    /**
     * Wann der Zaehler ablaeuft - als Zeitpunkt und nicht als Restzahl.
     *
     * <p>Dieselbe Ueberlegung wie am Rechner: Zaehlschritte driften, und der
     * Wechsel kaeme spuerbar spaeter als angekuendigt. Null heisst: es laeuft
     * keiner.
     */
    private long zaehlerBis;
    /**
     * Zu welchem Ziel schon gewechselt wurde und zu welchem abgebrochen.
     *
     * <p>Beide als Adresse und nicht als Ja/Nein: die naechste Folge wird
     * mehrfach neu bestimmt, und dazwischen steht sie kurz auf leer. Ein
     * Merker, der an "hat sich geaendert" haengt, faellt bei jedem dieser
     * Zwischenstaende um - einer, der an der Adresse haengt, nicht.
     */
    private String zaehlerFuer = "";
    private String abgebrochenFuer = "";
    /** Woran erkannt wird, dass sich am Zustand wirklich etwas geaendert hat. */
    private String letztesProtokoll = "";
    private boolean imVollbild;
    private boolean steuerungAn = true;
    private boolean gemeldetAn = true;
    private boolean steuerungGemeldet;

    /**
     * Nach der Ruhezeit zuruecktreten.
     *
     * <p>Zuruecktreten und nicht verschwinden - siehe {@link #RUHE_DECKKRAFT}.
     * Solange der Fokus auf der Leiste steht oder ein Zaehler laeuft, bleibt
     * sie voll da: das eine naehme der Fernbedienung den Platz, an dem sie
     * steht, das andere waere eine Ansage, die sich wegduckt.
     */
    private final Runnable ruheEintreten = new Runnable() {
        @Override
        public void run() {
            if (wurzel.hasFocus() || zaehlt()) {
                haupt.postDelayed(this, RUHE_MS);
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
            ? TvViews.hauptPillButton(context, KNOPF_TEXT, this::naechsteGedrueckt)
            : MobileViews.primaryButton(context, KNOPF_TEXT, this::naechsteGedrueckt);
        knopfAbbrechen = tv
            ? TvViews.pillButton(context, "Abbrechen", this::abbrechenGedrueckt)
            : MobileViews.secondaryButton(context, "Abbrechen", this::abbrechenGedrueckt);
        knopfAutoplay = tv
            ? TvViews.pillButton(context, autoplayText(), this::autoplayGedrueckt)
            : MobileViews.secondaryButton(context, autoplayText(), this::autoplayGedrueckt);

        // Der Schalter steht links und bleibt stehen; rechts davon kommt das,
        // was zur laufenden Folge gehoert. So wandert der Schalter nicht unter
        // dem Finger weg, wenn der Knopf bei neunzig Prozent dazukommt.
        wurzel.addView(knopfAutoplay, knopfMass(tv));
        wurzel.addView(knopfAbbrechen, mitAbstand(knopfMass(tv)));
        wurzel.addView(knopfNaechste, mitAbstand(knopfMass(tv)));
        knopfNaechste.setVisibility(View.GONE);
        knopfAbbrechen.setVisibility(View.GONE);
        aussehenAnwenden();
    }

    private LinearLayout.LayoutParams mitAbstand(LinearLayout.LayoutParams mass) {
        mass.leftMargin = dp(8);
        return mass;
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
        anwenden();
    }

    /**
     * Wie weit die Folge ist.
     *
     * <p>Die beiden Angaben schliessen einander aus (siehe
     * {@link Folgen#nahAmEnde}): erst der Knopf, dann der Zaehler.
     */
    void setzeFortschritt(boolean nah, boolean ende) {
        if (nahAmEnde == nah && amEnde == ende) return;
        nahAmEnde = nah;
        amEnde = ende;
        anwenden();
    }

    /** Den Schalter nachziehen - nach dem Umlegen und beim Aufbau. */
    void autoplayAuffrischen() {
        knopfAutoplay.setText(autoplayText());
        // Ein umgelegter Schalter gilt sofort: aus haelt einen laufenden
        // Zaehler an, an laesst ihn am Ende der Folge wieder anfangen.
        anwenden();
    }

    private String autoplayText() {
        return umgebung.autoplayAn() ? "Autoplay: An" : "Autoplay: Aus";
    }

    private void naechsteGedrueckt() {
        regung();
        // Der Zaehler ist damit erledigt - gedrueckt ist gedrueckt. Der Merker
        // {@code zaehlerFuer} wird hier ausdruecklich *nicht* gesetzt: geht der
        // Wechsel schief, soll der Zaehler am Ende der Folge trotzdem noch
        // anfangen duerfen.
        zaehlerAnhalten();
        knopfNaechste.setText("Wird geladen …");
        knopfAbbrechen.setVisibility(View.GONE);
        umgebung.naechsteFolge(true);
    }

    private void abbrechenGedrueckt() {
        regung();
        // Abbrechen haelt nur den Zaehler an. Der Knopf bleibt, damit man
        // trotzdem von Hand weiterspringen kann - dieselbe Aufteilung wie am
        // Rechner.
        Log.i(TAG, "FOLGE zaehler abgebrochen -> " + Folgen.kurz(ziel));
        abgebrochenFuer = ziel;
        zaehlerAnhalten();
        anwenden();
    }

    private void autoplayGedrueckt() {
        regung();
        umgebung.autoplaySetzen(!umgebung.autoplayAn());
        autoplayAuffrischen();
    }

    /* ------------------------------------------------------- Der Zaehler */

    /** Ob gerade gezaehlt wird - daran haengt auch, dass die Leiste stehen bleibt. */
    boolean zaehlt() {
        return zaehlerBis > 0;
    }

    private void zaehlerAnhalten() {
        zaehlerBis = 0;
        haupt.removeCallbacks(zaehlerTakt);
    }

    private final Runnable zaehlerTakt = new Runnable() {
        @Override
        public void run() {
            if (zaehlerBis <= 0) return;
            long rest = zaehlerBis - SystemClock.uptimeMillis();
            if (rest > 0) {
                knopfNaechste.setText("Nächste Folge in " + (int) Math.ceil(rest / 1000.0) + " …");
                haupt.postDelayed(this, ZAEHLER_TAKT_MS);
                return;
            }
            Log.i(TAG, "FOLGE zaehler abgelaufen -> " + Folgen.kurz(ziel));
            zaehlerAnhalten();
            knopfNaechste.setText("Wird geladen …");
            knopfAbbrechen.setVisibility(View.GONE);
            // Gemerkt, bevor gefahren wird: der Messtakt laeuft weiter, und
            // ohne diesen Merker finge der Zaehler beim naechsten Takt derselben
            // Folge von vorn an.
            zaehlerFuer = ziel;
            umgebung.naechsteFolge(false);
        }
    };

    /**
     * Was gerade dastehen soll - Knoepfe, Zaehler und Sichtbarkeit in einem.
     *
     * <p>Eine Stelle, weil alle drei von denselben vier Angaben abhaengen
     * (laeuft etwas, wie weit ist es, gibt es eine naechste Folge, ist der
     * Automatismus erlaubt). Verteilt auf drei Setzer waeren es drei
     * Gelegenheiten, einen Fall zu vergessen.
     */
    private void anwenden() {
        boolean hatZiel = !ziel.isEmpty();
        boolean knopfDa = hatZiel && (nahAmEnde || amEnde);
        boolean zaehlenSoll = hatZiel && amEnde
            && !ziel.equals(abgebrochenFuer) && !ziel.equals(zaehlerFuer)
            && umgebung.autoplayAn() && umgebung.zaehlerErlaubt();

        if (zaehlenSoll && !zaehlt()) {
            Log.i(TAG, "FOLGE zaehler an -> " + Folgen.kurz(ziel));
            zaehlerBis = SystemClock.uptimeMillis() + Folgen.ZAEHLER_SEKUNDEN * 1000L;
            // Ein Zaehler ist eine Ansage - dafuer gehoert die Leiste sichtbar,
            // auch wenn der Player seine Bedienelemente gerade weggenommen hat.
            regung();
            haupt.post(zaehlerTakt);
        } else if (!zaehlenSoll && zaehlt()) {
            Log.i(TAG, "FOLGE zaehler aus - " + (!hatZiel ? "kein Ziel"
                : ziel.equals(abgebrochenFuer) ? "abgebrochen"
                : ziel.equals(zaehlerFuer) ? "schon gefahren"
                : !amEnde ? "nicht mehr am Ende"
                : !umgebung.autoplayAn() ? "Autoplay aus" : "nicht erlaubt"));
            zaehlerAnhalten();
        }

        if (!zaehlt()) knopfNaechste.setText(KNOPF_TEXT);
        // Verschwindet ein Knopf, waehrend er den Fokus haelt, faellt der Fokus
        // ins Nichts und die Fernbedienung steht irgendwo. Er wird
        // weitergereicht, bevor der Knopf geht.
        if (!knopfDa && knopfNaechste.hasFocus()) knopfAutoplay.requestFocus();
        if (!zaehlt() && knopfAbbrechen.hasFocus()) knopfAutoplay.requestFocus();
        knopfNaechste.setVisibility(knopfDa ? View.VISIBLE : View.GONE);
        knopfAbbrechen.setVisibility(zaehlt() ? View.VISIBLE : View.GONE);
        wurzel.setVisibility(amSchauen ? View.VISIBLE : View.GONE);
        wurzel.setAlpha(deckkraft(imVollbild, steuerungAn, zaehlt()));
        protokoll(knopfDa);
    }

    /**
     * Was die Leiste gerade zeigt - und warum.
     *
     * <p>Nur bei Aenderung. Der Messtakt ruft {@code anwenden()} alle fuenf
     * Sekunden, und eine Zeile je Takt waere im Protokoll nicht mehr zu lesen.
     * Nachzusehen mit: {@code adb logcat -s ELFIX | grep FOLGE}
     */
    private void protokoll(boolean knopfDa) {
        String stand = "leiste sichtbar=" + amSchauen
            + " deckkraft=" + deckkraft(imVollbild, steuerungAn, zaehlt())
            + " knopf=" + knopfDa
            + " zaehler=" + zaehlt()
            + " ziel=" + (ziel.isEmpty() ? "-" : Folgen.kurz(ziel))
            + " nah=" + nahAmEnde + " ende=" + amEnde
            + " autoplay=" + umgebung.autoplayAn()
            + " zaehlerErlaubt=" + umgebung.zaehlerErlaubt()
            + " abgebrochen=" + (ziel.equals(abgebrochenFuer))
            + " schonGefahren=" + (ziel.equals(zaehlerFuer))
            + " vollbild=" + imVollbild
            + " steuerung=" + steuerungAn + "/" + steuerungGemeldet;
        if (stand.equals(letztesProtokoll)) return;
        letztesProtokoll = stand;
        Log.i(TAG, "FOLGE " + stand);
    }

    /* ------------------------------------- Im Vollbild: mit der Steuerung */

    /**
     * Ein neuer Player - was der alte gesagt hat, gilt nicht mehr.
     *
     * <p>Auch der Fortschritt. Ohne dieses Zuruecksetzen traegt die neue Seite
     * das "durchgelaufen" der vorigen weiter, und sobald ihre naechste Folge
     * feststeht, finge der Zaehler an - bei Sekunde null einer Folge, die
     * gerade erst laedt.
     */
    void playerNeu() {
        nahAmEnde = false;
        amEnde = false;
        zaehlerAnhalten();
        steuerungGemeldet = false;
        gemeldetAn = true;
        steuerungAn = true;
        haupt.removeCallbacks(ruheEintreten);
        if (imVollbild) haupt.postDelayed(ruheEintreten, RUHE_MS);
        anwenden();
    }

    /** Der Player sagt, ob seine Bedienelemente zu sehen sind. */
    void steuerungSichtbar(boolean an) {
        steuerungGemeldet = true;
        gemeldetAn = an;
        haupt.removeCallbacks(ruheEintreten);
        if (steuerungAn == an) return;
        steuerungAn = an;
        anwenden();
    }

    /** Jemand hat etwas getan - Beruehrung, D-Pad, Fernbedienung. */
    void regung() {
        haupt.removeCallbacks(ruheEintreten);
        haupt.postDelayed(ruheEintreten, RUHE_MS);
        if (steuerungAn) return;
        steuerungAn = true;
        anwenden();
    }

    /**
     * Wie deutlich die Leiste dasteht - ohne Ansicht, damit es sich pruefen
     * laesst.
     *
     * <p>Ob sie ueberhaupt dasteht, entscheidet allein, ob gerade eine
     * Wiedergabeseite offen ist. Sie wird nie unsichtbar: eine Leiste, die
     * verschwindet, ist ein Weg zur naechsten Folge, den es nicht gibt.
     *
     * <p>Ausserhalb des Vollbilds liegt sie neben dem Bild und verdeckt nichts,
     * also volle Deckkraft. Im Vollbild liegt sie auf dem Video und tritt nach
     * kurzer Ruhe zurueck - so weit, dass sie nicht stoert, und so wenig, dass
     * man sie noch findet. Waehrend gezaehlt wird, steht sie voll da: ein
     * Zaehler, den man nicht sieht, ist keine Ansage, und "Abbrechen" waere ein
     * Knopf, den es nur unsichtbar gibt.
     */
    static float deckkraft(boolean imVollbild, boolean steuerungAn, boolean zaehlt) {
        if (!imVollbild || zaehlt || steuerungAn) return 1f;
        return RUHE_DECKKRAFT;
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
        haupt.removeCallbacks(ruheEintreten);
        if (imVollbild) haupt.postDelayed(ruheEintreten, RUHE_MS);
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
