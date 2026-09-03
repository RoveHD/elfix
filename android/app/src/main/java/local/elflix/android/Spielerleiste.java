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
    static final long RUHE_MS = 5000;
    /**
     * Wie durchsichtig sie im mittleren Schritt wird.
     *
     * <p>Hoeher als die {@code opacity: 0.12} des Rechners, weil eine
     * Beruehrung kein Zeiger ist: was man nicht sieht, tippt man auch nicht an.
     */
    private static final float RUHE_DECKKRAFT = 0.4f;
    /**
     * Und wie lange sie danach noch bleibt, bevor sie ganz geht.
     *
     * <p>Zusammen mit {@link #RUHE_MS} sind das die zehn Sekunden, nach denen
     * vom Knopf nichts mehr zu sehen ist.
     */
    private static final long VERBLASSEN_MS = 5000;
    /**
     * Wie lange der Autoplay-Schalter nach der letzten Regung dasteht.
     *
     * <p>Deutlich kuerzer als {@link #RUHE_MS}, und aus einem anderen Grund als
     * die Leiste: die Leiste traegt den einzigen Weg zur naechsten Folge und
     * muss auffindbar bleiben, der Schalter ist eine Einstellung. Fuenf
     * Sekunden Einstellung auf dem Video sind vier zu viel - gemeldet als "das
     * Autoplay bleibt viel zu lang sichtbar".
     *
     * <p>Der Fokus und ein laufender Zaehler halten ihn trotzdem: das eine
     * naehme der Fernbedienung den Platz, an dem sie steht, das andere waere
     * eine Ansage, die sich wegduckt.
     */
    static final long AUTOPLAY_RUHE_MS = 1200;

    /**
     * Die drei Schritte, in denen die Leiste im Vollbild zuruecktritt.
     *
     * <h2>Warum sie ueberhaupt ganz geht - und warum das diesmal richtig ist</h2>
     *
     * <p>Hier stand einmal {@code View.GONE} nach dreieinhalb Sekunden, und das
     * war ein Fehler: auf dem Telefon lief eine Folge bis zum Ende, ohne dass je
     * ein Knopf zu sehen war. Danach stand hier "sie verschwindet nie" und ein
     * fester Wert von 0,4 - und das war der naechste Fehler, nur ein leiserer:
     * ein Kasten, der eine Stunde lang halb durchsichtig ueber dem Bild klebt,
     * ist genau das, was beim Schauen stoert.
     *
     * <p>Der Unterschied zum ersten Anlauf ist nicht die Zeit, sondern der
     * Rueckweg. Damals gab es keinen: der Ausloeser zum Wiederkommen war die
     * Meldung des Player-Horchers, und die kommt nur mit eingeschalteter
     * Watchparty. Heute holt jede Beruehrung und jede Taste die Leiste zurueck
     * ({@code regung()} haengt in {@code dispatchTouchEvent} und
     * {@code dispatchKeyEvent}) - dieselbe Geste, mit der man auch die
     * Bedienleiste des Hosters wieder hervorholt. Wer den Knopf sucht, tippt
     * ohnehin ans Bild.
     *
     * <p>Zwei Ausnahmen bleiben: waehrend eines Zaehlers steht sie voll da (eine
     * Ansage, die sich wegduckt, ist keine), und solange der Fokus auf ihr
     * liegt, ruecken die Schritte gar nicht erst weiter - sonst naehme sie der
     * Fernbedienung den Platz weg, an dem sie steht.
     */
    enum Stufe {
        /** Voll da. */
        VOLL,
        /** Zurueckgetreten, aber auffindbar. */
        GEDIMMT,
        /** Weg - und zwar {@code GONE}, nicht durchsichtig. */
        WEG
    }
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
    /**
     * Der Autoplay-Schalter, in einem eigenen Halter.
     *
     * <p>Er sass bis hierher in derselben Zeile wie "Naechste Folge" und teilte
     * sich damit alles: Platz, Deckkraft, Sichtbarkeit. Das war der gemeldete
     * Fehler - zwei Bedienelemente mit zwei Aufgaben und zwei Regeln koennen
     * nicht ein Element sein. Der Knopf folgt weiter der Regel des Rechners
     * (ab neunzig Prozent, unten rechts); der Schalter liegt oben links und
     * kommt und geht mit der Bedienleiste des Players.
     */
    private final LinearLayout autoplayHalter;
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
    /** In welchem der drei Schritte die Leiste gerade steht. Siehe {@link Stufe}. */
    private Stufe stufe = Stufe.VOLL;
    /** Ob der Schalter seine eigene, kurze Ruhezeit noch vor sich hat. */
    private boolean autoplayVoll = true;
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
    /**
     * Was der Takt beim naechsten Schlag tut.
     *
     * <p>Eigener Typ, damit sich die Regel ohne Ansicht und ohne Handler
     * pruefen laesst - dieselbe Ueberlegung wie bei {@link #leisteSichtbar}
     * und {@link #deckkraft}.
     */
    enum Schritt {
        /** Nichts aendern, aber wiederkommen. */
        WARTEN,
        /** Von voll auf zurueckgetreten. */
        DIMMEN,
        /** Von zurueckgetreten auf weg. Danach ist nichts mehr zu tun. */
        VERSCHWINDEN
    }

    /**
     * Der naechste Schritt der Ausblendkette.
     *
     * <p><b>Der Fehler, den diese Funktion pruefbar macht.</b> Meldete der
     * Player, dass seine eigene Bedienleiste steht, endete die Kette hier mit
     * einem {@code return} ohne Fortsetzung. Eine Sackgasse: von da an lief
     * kein Takt mehr, und die Leiste kam nur noch durch eine Beruehrung oder
     * eine erneute Meldung des Players in den Ablauf zurueck. Wer auf dem
     * Fernseher zuschaut, tut beides nicht - dort blieb sie bis zum Ende der
     * Folge stehen. Gemeldet als "die Leiste blendet sich nicht mehr aus".
     *
     * <p>Richtig ist {@link Schritt#WARTEN}: aufgeschoben, nicht aufgehoben.
     * Solange die Bedienleiste des Players steht, ist ohnehin etwas zu sehen,
     * und sobald sie geht, ruecken die Schritte weiter.
     *
     * @param fokusDrauf   die Fernbedienung steht auf der Leiste oder auf dem
     *                     Schalter - sie darf ihr den Platz nicht wegnehmen
     * @param zaehlt       ein Zaehler laeuft; eine Ansage duckt sich nicht weg
     * @param playerLeiste der Player meldet seine eigene Bedienleiste als
     *                     sichtbar
     */
    static Schritt naechsterSchritt(boolean fokusDrauf, boolean zaehlt, boolean playerLeiste,
                                    Stufe stufe) {
        if (zaehlt) return Schritt.WARTEN;
        if (playerLeiste) return Schritt.WARTEN;
        if (stufe == Stufe.VOLL) return Schritt.DIMMEN;
        // Der letzte Schritt nimmt die Ansicht wirklich weg. Haelt sie den
        // Fokus, waere das der Fernbedienung der Boden unter den Fuessen -
        // also bleibt sie stehen, nur zurueckgetreten.
        //
        // Zuruecktreten darf sie trotzdem, und genau daran lag der gemeldete
        // Fehler. Der Fokus stand hier weiter oben und hielt *jeden* Schritt
        // auf; auf dem Fernseher heisst das: fuer immer. Nachgestellt am
        // 2026-08-28 im TV-Emulator an einer echten Folge - nach einem Druck
        // auf das Steuerkreuz sass der Fokus auf "Autoplay: An", und der
        // Kasten stand von da an bei voller Deckkraft ueber dem Video, bis
        // wieder jemand eine Taste drueckte. Ohne Tastendruck also bis zum
        // Ende der Folge.
        if (stufe == Stufe.GEDIMMT) return fokusDrauf ? Schritt.WARTEN : Schritt.VERSCHWINDEN;
        return Schritt.WARTEN;
    }

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
            Schritt schritt = naechsterSchritt(
                wurzel.hasFocus() || autoplayHalter.hasFocus(),
                zaehlt(),
                steuerungGemeldet && gemeldetAn,
                stufe);
            switch (schritt) {
                case WARTEN:
                    haupt.postDelayed(this, RUHE_MS);
                    return;
                case DIMMEN:
                    stufe = Stufe.GEDIMMT;
                    // Nur zurueckgetreten, noch nicht weg: der zweite Schritt
                    // kommt von selbst.
                    haupt.postDelayed(this, VERBLASSEN_MS);
                    anwenden();
                    return;
                case VERSCHWINDEN:
                default:
                    stufe = Stufe.WEG;
                    anwenden();
            }
        }
    };

    /**
     * Den Schalter nach seiner kurzen Zeit wegnehmen.
     *
     * <p>Er verschwindet fuer sich, ohne die Leiste mitzunehmen: die beiden
     * haben denselben Ausloeser, aber nicht dieselbe Aufgabe.
     */
    private final Runnable autoplayZurueck = new Runnable() {
        @Override
        public void run() {
            if (autoplayBleibt(knopfAutoplay.hasFocus(), zaehlt())) {
                haupt.postDelayed(this, AUTOPLAY_RUHE_MS);
                return;
            }
            if (!autoplayVoll) return;
            autoplayVoll = false;
            anwenden();
        }
    };

    /** Den Schalter wieder holen und seine kurze Zeit neu anwerfen. */
    private void autoplayZeigen() {
        haupt.removeCallbacks(autoplayZurueck);
        if (imVollbild) haupt.postDelayed(autoplayZurueck, AUTOPLAY_RUHE_MS);
        autoplayVoll = true;
    }

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

        // In der Leiste steht nur noch, was zur laufenden Folge gehoert. Der
        // Schalter hat seinen eigenen Halter und seinen eigenen Platz - so
        // wandert der Knopf nicht unter dem Finger weg, wenn der Schalter mit
        // der Bedienleiste des Players verschwindet, und umgekehrt.
        wurzel.addView(knopfAbbrechen, knopfMass(tv));
        wurzel.addView(knopfNaechste, mitAbstand(knopfMass(tv)));
        knopfNaechste.setVisibility(View.GONE);
        knopfAbbrechen.setVisibility(View.GONE);

        autoplayHalter = new LinearLayout(context);
        autoplayHalter.setOrientation(LinearLayout.HORIZONTAL);
        autoplayHalter.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        autoplayHalter.setClipChildren(false);
        autoplayHalter.setClipToPadding(false);
        autoplayHalter.setVisibility(View.GONE);
        autoplayHalter.addView(knopfAutoplay, knopfMass(tv));

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

    /**
     * Der Schalter als eigene Ansicht - er wird getrennt eingehaengt.
     *
     * <p>Getrennt, weil er getrennt verschwinden muss: {@code View.GONE} und
     * nicht durchsichtig. Ein Element, das man nicht sieht, aber das Platz
     * belegt, den Fokus annimmt und Beruehrungen abfaengt, ist schlimmer als
     * eines, das dasteht.
     */
    View autoplayAnsicht() {
        return autoplayHalter;
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

    /** Die Fuellung des Zaehlerknopfs - nur waehrend gezaehlt wird. */
    private android.graphics.drawable.ClipDrawable zaehlerFuellung;

    /** Der gewohnte Hintergrund des Knopfs, waehrend die Fuellung darauf liegt. */
    private android.graphics.drawable.Drawable knopfHintergrund;

    /** Die zuletzt angesagte Sekunde - damit je Sekunde genau ein Herzschlag kommt. */
    private int letzteZaehlerSekunde = -1;

    private void zaehlerAnhalten() {
        zaehlerBis = 0;
        letzteZaehlerSekunde = -1;
        haupt.removeCallbacks(zaehlerTakt);
        zaehlerAnzeigeAus();
    }

    /**
     * Die Fuellung des Zaehlerknopfs anlegen.
     *
     * <p>Zwei Schichten: die gewohnte Knopfform unten, darueber dieselbe Form
     * in Hell, von links her aufgedeckt. Der gewohnte Hintergrund wird vorher
     * beiseitegelegt und danach wieder eingesetzt - der Knopf soll nach dem
     * Zaehler aussehen wie vorher.
     */
    private void zaehlerAnzeigeAn() {
        if (zaehlerFuellung != null) return;
        knopfHintergrund = knopfNaechste.getBackground();
        int ecke = umgebung.fernseher() ? 26 : 12;
        android.graphics.drawable.Drawable unten = MobileViews.shape(context,
            Theme.PRIMARY_DEEP, ecke, Color.TRANSPARENT, 0);
        android.graphics.drawable.Drawable oben = MobileViews.shape(context,
            Theme.PRIMARY, ecke, Color.TRANSPARENT, 0);
        zaehlerFuellung = new android.graphics.drawable.ClipDrawable(oben, Gravity.START,
            android.graphics.drawable.ClipDrawable.HORIZONTAL);
        zaehlerFuellung.setLevel(0);
        knopfNaechste.setBackground(new android.graphics.drawable.LayerDrawable(
            new android.graphics.drawable.Drawable[]{unten, zaehlerFuellung}));
    }

    /** Und wieder weg damit. */
    private void zaehlerAnzeigeAus() {
        if (zaehlerFuellung == null) return;
        zaehlerFuellung = null;
        if (knopfHintergrund != null) knopfNaechste.setBackground(knopfHintergrund);
        knopfHintergrund = null;
        knopfNaechste.animate().cancel();
        knopfNaechste.setScaleX(1f);
        knopfNaechste.setScaleY(1f);
    }

    private final Runnable zaehlerTakt = new Runnable() {
        @Override
        public void run() {
            if (zaehlerBis <= 0) return;
            long rest = zaehlerBis - SystemClock.uptimeMillis();
            if (rest > 0) {
                int sekunden = (int) Math.ceil(rest / 1000.0);
                knopfNaechste.setText("Nächste Folge in " + sekunden + " …");
                // Der Knopf laeuft voll. Ueber die Fuellhoehe eines
                // ClipDrawable und nicht ueber eine zweite Ansicht: so aendert
                // sich nichts am Aufbau der Leiste, und ein Knopf, der sich
                // fuellt, ist genau die Anzeige, die ein Countdown braucht.
                long ganz = Folgen.ZAEHLER_SEKUNDEN * 1000L;
                if (zaehlerFuellung != null && ganz > 0) {
                    zaehlerFuellung.setLevel((int) (10000L * (ganz - rest) / ganz));
                }
                // Einmal je Sekunde ein Herzschlag - aber nicht, solange die
                // Fernbedienung darauf steht: dort haelt der Fokus die Groesse,
                // und zwei Kraefte an derselben Groesse ergeben ein Zittern.
                if (sekunden != letzteZaehlerSekunde) {
                    letzteZaehlerSekunde = sekunden;
                    if (!knopfNaechste.hasFocus()) Bewegung.pochen(knopfNaechste, 1);
                }
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
            zaehlerAnzeigeAn();
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

        // Der Schalter: er steht, solange etwas laeuft *und* die Bedienleiste
        // des Players dasteht - und sonst gar nicht. Nicht durchsichtig,
        // sondern GONE: so belegt er keinen Platz, nimmt keinen Fokus an und
        // faengt keine Beruehrung ab. Der Zaehler ist die eine Ausnahme, aus
        // demselben Grund wie bei der Leiste: waehrend einer Ansage soll man
        // den Automatismus abschalten koennen, ohne erst das Bild antippen zu
        // muessen.
        boolean autoplayDa = autoplaySichtbar(amSchauen, autoplayVoll && stufe == Stufe.VOLL,
            zaehlt());
        // Erst den Fokus retten, dann verschwinden. Andersherum faellt er ins
        // Nichts, und die Fernbedienung steht irgendwo.
        if (!autoplayDa && knopfAutoplay.hasFocus()) {
            if (!(knopfDa && knopfNaechste.requestFocus())) knopfAutoplay.clearFocus();
        }
        autoplayHalter.setVisibility(autoplayDa ? View.VISIBLE : View.GONE);

        // Verschwindet ein Knopf, waehrend er den Fokus haelt, faellt der Fokus
        // ins Nichts und die Fernbedienung steht irgendwo. Er wird
        // weitergereicht, bevor der Knopf geht - an den Schalter, sofern der
        // ueberhaupt dasteht.
        if (!knopfDa && knopfNaechste.hasFocus() && !(autoplayDa && knopfAutoplay.requestFocus())) {
            knopfNaechste.clearFocus();
        }
        if (!zaehlt() && knopfAbbrechen.hasFocus() && !(autoplayDa && knopfAutoplay.requestFocus())) {
            knopfAbbrechen.clearFocus();
        }
        boolean naechsteWar = knopfNaechste.getVisibility() == View.VISIBLE;
        boolean abbrechenWar = knopfAbbrechen.getVisibility() == View.VISIBLE;
        knopfNaechste.setVisibility(knopfDa ? View.VISIBLE : View.GONE);
        knopfAbbrechen.setVisibility(zaehlt() ? View.VISIBLE : View.GONE);
        // Nur beim Erscheinen und nur beim wirklichen Wechsel: anwenden()
        // laeuft alle fuenf Sekunden, und ein Knopf, der dabei jedes Mal
        // aufpoppt, waere ein Zucken.
        if (knopfDa && !naechsteWar) Bewegung.hereinPoppen(knopfNaechste);
        if (zaehlt() && !abbrechenWar) Bewegung.hereinPoppen(knopfAbbrechen);
        // Die Leiste selbst: nur mit Inhalt, und im Vollbild nur bis zum
        // letzten der drei Schritte. Ein leerer Kasten ist ein Punkt auf dem
        // Video und kein Bedienelement - siehe leisteSichtbar.
        boolean inhaltDa = knopfDa || zaehlt();
        boolean leisteDa = leisteSichtbar(amSchauen, inhaltDa, imVollbild, stufe, zaehlt());
        // Erst den Fokus retten, dann verschwinden - dieselbe Reihenfolge wie
        // bei den Knoepfen darin.
        if (!leisteDa && wurzel.hasFocus() && !(autoplayDa && knopfAutoplay.requestFocus())) {
            wurzel.clearFocus();
        }
        leisteZeigen(leisteDa, deckkraft(imVollbild, stufe, zaehlt()));
        protokoll(knopfDa, autoplayDa);
    }

    /**
     * Die Leiste ein- oder ausfahren.
     *
     * <p>Sie haengt unten, also kommt sie von unten - der Weg ist ihre eigene
     * Hoehe, damit sie wirklich hinter der Kante verschwindet und nicht bloss
     * blass wird. Die Deckkraft bleibt dabei die des Ruhezustands: die Leiste
     * tritt nach einer Weile zurueck, ohne zu gehen, und das ist eine andere
     * Aussage als "weg".
     *
     * <p>Was hier <em>nicht</em> passiert: an der Entscheidung wird nichts
     * geaendert. Wer den Fokus abgibt und wann, steht weiter oben und ist
     * schon gelaufen, bevor diese Zeilen an die Reihe kommen.
     */
    private void leisteZeigen(boolean da, float deckkraft) {
        boolean war = wurzel.getVisibility() == View.VISIBLE;
        long dauer = Bewegung.dauer(context, Bewegung.LANG);
        int hoehe = wurzel.getHeight();
        if (da) {
            wurzel.animate().cancel();
            wurzel.setVisibility(View.VISIBLE);
            wurzel.setAlpha(deckkraft);
            if (!war && dauer > 0 && hoehe > 0) {
                wurzel.setTranslationY(hoehe);
                wurzel.animate().translationY(0f)
                    .setDuration(dauer).setInterpolator(Bewegung.hinein()).withLayer().start();
            } else {
                wurzel.setTranslationY(0f);
            }
            return;
        }
        if (!war) {
            wurzel.setVisibility(View.GONE);
            wurzel.setTranslationY(0f);
            return;
        }
        if (dauer <= 0 || hoehe <= 0) {
            wurzel.setVisibility(View.GONE);
            wurzel.setTranslationY(0f);
            return;
        }
        wurzel.animate().translationY(hoehe).alpha(0f)
            .setDuration(dauer).setInterpolator(Bewegung.hinaus()).withLayer()
            .withEndAction(() -> {
                wurzel.setVisibility(View.GONE);
                wurzel.setTranslationY(0f);
                wurzel.setAlpha(1f);
            })
            .start();
    }

    /**
     * Was die Leiste gerade zeigt - und warum.
     *
     * <p>Nur bei Aenderung. Der Messtakt ruft {@code anwenden()} alle fuenf
     * Sekunden, und eine Zeile je Takt waere im Protokoll nicht mehr zu lesen.
     * Nachzusehen mit: {@code adb logcat -s ELFIX | grep FOLGE}
     */
    private void protokoll(boolean knopfDa, boolean autoplayDa) {
        String stand = "leiste sichtbar=" + (wurzel.getVisibility() == View.VISIBLE)
            + " stufe=" + stufe
            + " deckkraft=" + deckkraft(imVollbild, stufe, zaehlt())
            + " knopf=" + knopfDa
            + " autoplaySichtbar=" + autoplayDa
            + " zaehler=" + zaehlt()
            + " ziel=" + (ziel.isEmpty() ? "-" : Folgen.kurz(ziel))
            + " nah=" + nahAmEnde + " ende=" + amEnde
            + " autoplay=" + umgebung.autoplayAn()
            + " zaehlerErlaubt=" + umgebung.zaehlerErlaubt()
            + " abgebrochen=" + (ziel.equals(abgebrochenFuer))
            + " schonGefahren=" + (ziel.equals(zaehlerFuer))
            + " vollbild=" + imVollbild
            + " steuerung=" + steuerungGemeldet + "/" + gemeldetAn;
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
        stufe = Stufe.VOLL;
        haupt.removeCallbacks(ruheEintreten);
        if (imVollbild) haupt.postDelayed(ruheEintreten, RUHE_MS);
        autoplayZeigen();
        anwenden();
    }

    /**
     * Der Player sagt, ob seine Bedienelemente zu sehen sind.
     *
     * <p>Sind sie da - beim Pausieren, bei der Ueberlagerung des Hosters, bei
     * jedem Antippen -, faengt die Leiste wieder bei voll an. Sind sie weg,
     * laeuft der Takt von vorn los: erst zurueckgetreten, dann weg.
     */
    void steuerungSichtbar(boolean an) {
        steuerungGemeldet = true;
        gemeldetAn = an;
        haupt.removeCallbacks(ruheEintreten);
        if (an) {
            zeigen();
            return;
        }
        // Der Player hat seine Leiste weggenommen: von hier an zaehlt der Takt.
        if (imVollbild) haupt.postDelayed(ruheEintreten, RUHE_MS);
    }

    /** Jemand hat etwas getan - Beruehrung, D-Pad, Fernbedienung. */
    void regung() {
        zeigen();
    }

    /**
     * Die Leiste wieder ganz nach vorn holen und den Takt neu anwerfen.
     *
     * <p>Der eine Weg zurueck - egal ob ihn eine Beruehrung, eine Taste oder
     * der Player selbst ausloest. Ausserhalb des Vollbilds laeuft kein Takt:
     * dort verdeckt die Leiste nichts und hat keinen Grund, sich zu ducken.
     */
    private void zeigen() {
        haupt.removeCallbacks(ruheEintreten);
        if (imVollbild) haupt.postDelayed(ruheEintreten, RUHE_MS);
        boolean warVoll = stufe == Stufe.VOLL;
        boolean schalterWar = autoplayVoll;
        autoplayZeigen();
        stufe = Stufe.VOLL;
        // Nichts hat sich geaendert: dann auch nicht neu zeichnen. anwenden()
        // laeuft ohnehin oft genug.
        if (warVoll && schalterWar) return;
        anwenden();
    }

    /**
     * Wie deutlich die Leiste dasteht - ohne Ansicht, damit es sich pruefen
     * laesst.
     *
     * <p>Ausserhalb des Vollbilds liegt sie neben dem Bild und verdeckt nichts,
     * also volle Deckkraft, egal welcher Schritt gerade gilt. Waehrend gezaehlt
     * wird ebenso: ein Zaehler, den man nicht sieht, ist keine Ansage, und
     * "Abbrechen" waere ein Knopf, den es nur unsichtbar gibt.
     *
     * <p>Im Vollbild folgt sie den drei Schritten. Der letzte gibt hier zwar
     * null zurueck, gezeichnet wird er aber gar nicht mehr - dafuer sorgt
     * {@link #leisteSichtbar}. Eine Ansicht, die nur durchsichtig ist, belegt
     * weiter Platz, nimmt Fokus an und faengt Beruehrungen ab.
     */
    static float deckkraft(boolean imVollbild, Stufe stufe, boolean zaehlt) {
        if (!imVollbild || zaehlt) return 1f;
        if (stufe == Stufe.GEDIMMT) return RUHE_DECKKRAFT;
        if (stufe == Stufe.WEG) return 0f;
        return 1f;
    }

    /**
     * Ob die Leiste ueberhaupt gezeichnet wird - ohne Ansicht, damit es sich
     * pruefen laesst.
     *
     * <h2>Der leere Kasten</h2>
     *
     * <p>{@code inhaltDa} ist der gemeldete Fehler: die Leiste war sichtbar,
     * solange ueberhaupt eine Folge lief - auch dann, wenn beide Knoepfe darin
     * {@code GONE} waren. Uebrig blieb ihr eigener Hintergrund: ein gerundeter
     * Kasten von zweimal zwoelf dp Innenabstand, also ein dunkler Punkt, der
     * unten rechts im Video klebte. Die ersten neunzig Prozent jeder Folge
     * bestand die Leiste aus genau diesem Punkt und sonst nichts.
     *
     * <p>Ein Behaelter ohne Inhalt gehoert nicht auf den Schirm. Steht weder
     * "Naechste Folge" noch "Abbrechen", ist die Leiste weg.
     */
    static boolean leisteSichtbar(boolean amSchauen, boolean inhaltDa, boolean imVollbild,
            Stufe stufe, boolean zaehlt) {
        if (!amSchauen || !inhaltDa) return false;
        if (!imVollbild || zaehlt) return true;
        return stufe != Stufe.WEG;
    }

    /**
     * Ob der Autoplay-Schalter dasteht - ohne Ansicht, damit es sich pruefen
     * laesst.
     *
     * <p>Bewusst eine andere Regel als {@link #deckkraft}, und das ist der
     * ganze Punkt der Aenderung: die Leiste <em>tritt zurueck</em>, der
     * Schalter <em>geht weg</em>. Sie traegt den einzigen Weg zur naechsten
     * Folge und muss deshalb auffindbar bleiben; er ist eine Einstellung, und
     * eine Einstellung, die auf dem Video klebt, verdeckt es nur.
     *
     * <p>Er haengt damit an der Bedienleiste des Players und an sonst nichts -
     * insbesondere nicht daran, ob "Naechste Folge" gerade dasteht. Die beiden
     * hingen bis hierher aneinander, weil sie eine Ansicht waren.
     *
     * <p>Die eine Ausnahme ist der Zaehler: waehrend einer Ansage soll man den
     * Automatismus abschalten koennen, ohne erst das Bild antippen zu muessen.
     */
    /**
     * Ob der Schalter seine kurze Zeit ueberspringt - ohne Ansicht, damit es
     * sich pruefen laesst.
     *
     * <p>Zwei Gruende halten ihn: der Fokus steht auf ihm, dann naehme sein
     * Verschwinden der Fernbedienung den Platz, an dem sie steht. Oder ein
     * Zaehler laeuft, dann ist er der Weg, ihn abzubrechen.
     */
    static boolean autoplayBleibt(boolean fokusDrauf, boolean zaehlt) {
        return fokusDrauf || zaehlt;
    }

    static boolean autoplaySichtbar(boolean amSchauen, boolean steuerungAn, boolean zaehlt) {
        if (!amSchauen) return false;
        return steuerungAn || zaehlt;
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
        if (autoplayHalter.getParent() instanceof ViewGroup) {
            ((ViewGroup) autoplayHalter.getParent()).removeView(autoplayHalter);
        }
        imVollbild = rahmen != null;
        aussehenAnwenden();
        // Beim Eintreten erst einmal da - die Bedienelemente des Players sind
        // in diesem Augenblick fast immer offen. Was danach gilt, sagt der
        // Player, und sonst der Takt.
        stufe = Stufe.VOLL;
        haupt.removeCallbacks(ruheEintreten);
        if (imVollbild) haupt.postDelayed(ruheEintreten, RUHE_MS);
        autoplayZeigen();
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

            // Der Schalter unten links - gegenueber von "Naechste Folge",
            // auf derselben Hoehe ueber der Bedienleiste des Hosters.
            //
            // Er stand hier einmal oben links, unter dem Live-Streifen, und
            // das ging genau so lange gut, wie der Streifen zugeklappt war.
            // Klappt jemand die Teilnehmer auf, waechst der Streifen nach
            // unten - und der Schalter lag mitten darin. Gemeldet als "das
            // Hostfenster kann man nicht lesen, wenn es aufgeklappt ist".
            //
            // Ein fester Abstand kann das nicht loesen: die Hoehe des
            // Streifens haengt daran, wie viele mitschauen. Unten gibt es
            // nichts, das waechst - dort steht nur die Leiste, und die haelt
            // die andere Seite.
            FrameLayout.LayoutParams autoplayMass = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            autoplayMass.gravity = Gravity.BOTTOM | Gravity.START;
            autoplayMass.leftMargin = dp(tv ? TvViews.SCREEN_PADDING : 12);
            autoplayMass.bottomMargin = dp(tv ? 96 : 64);
            rahmen.addView(autoplayHalter, autoplayMass);
            autoplayHalter.bringToFront();
            return;
        }
        if (zuhause != null) {
            // Neben dem Bild: der Schalter in seiner eigenen Zeile darueber,
            // linksbuendig. Die Leiste darunter behaelt ihre Zeile und damit
            // ihren Platz - "Naechste Folge" steht, wo es immer stand.
            zuhause.addView(autoplayHalter, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
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
        autoplayHalter.setPadding(rand, rand, rand, rand);
        if (imVollbild) {
            wurzel.setBackground(MobileViews.shape(context,
                Color.parseColor("#EC0B1220"), tv ? 18 : 14, Theme.BORDER, 1));
            autoplayHalter.setBackground(MobileViews.shape(context,
                Color.parseColor("#EC0B1220"), tv ? 18 : 14, Theme.BORDER, 1));
        } else {
            wurzel.setBackground(null);
            wurzel.setBackgroundColor(Theme.SURFACE);
            autoplayHalter.setBackground(null);
            autoplayHalter.setBackgroundColor(Theme.SURFACE);
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
        // Erst die Regung, dann nachsehen. Andersherum war es falsch, seit die
        // Leiste im letzten Schritt wirklich verschwindet: die Fernbedienung
        // fragte nach etwas, das genau in diesem Augenblick nicht dastand, und
        // bekam ein Nein - obwohl ein Tastendruck es hervorgeholt haette.
        regung();
        if (wurzel.getVisibility() != View.VISIBLE
            && autoplayHalter.getVisibility() != View.VISIBLE) {
            return false;
        }
        if (knopfNaechste.getVisibility() == View.VISIBLE && knopfNaechste.requestFocus()) return true;
        if (autoplayHalter.getVisibility() == View.VISIBLE && knopfAutoplay.requestFocus()) return true;
        return false;
    }

    boolean hatFokus() {
        return (wurzel.getVisibility() == View.VISIBLE && wurzel.hasFocus())
            || (autoplayHalter.getVisibility() == View.VISIBLE && autoplayHalter.hasFocus());
    }

    private int dp(int wert) {
        return Math.round(wert * context.getResources().getDisplayMetrics().density);
    }
}
