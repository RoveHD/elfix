package local.elflix.android;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;

/**
 * Der Live-Streifen ueber dem Bild - das Gegenstueck zur Kopfzeile am Rechner.
 *
 * <h2>Was hier gefehlt hat</h2>
 *
 * <p>Am Rechner steht waehrend des Schauens oben rechts, dass diese Folge live
 * mitlaeuft: der Raum, wer fuehrt, wer angehalten hat, ob die Verbindung steht -
 * und daneben je Geraet eine Marke mit Zeichen, Name und Uhr. Auf Android gab es
 * davon nichts. Der einzige Ort, an dem ueberhaupt etwas ueber die Runde stand,
 * war die Watchparty-Seite, also genau die Seite, auf der man beim Schauen nicht
 * ist. Man sah dem Bild nicht an, ob man allein schaut oder zu dritt.
 *
 * <h2>Wie er gebaut ist</h2>
 *
 * <p>Ein Streifen und kein Kasten. Er ist zusammengeklappt eine Zeile hoch und
 * legt sich nie ueber das Bild; erst auf Tippen oder OK klappt er die
 * Teilnehmer und die Aktionen aus und faellt nach kurzer Ruhe von selbst wieder
 * zusammen. Im Vollbild zieht er in den Vollbild-Rahmen um - dort ist er das
 * Einzige, was ueber dem Video liegen darf, und deshalb bleibt er dort
 * ausdruecklich schmal.
 *
 * <p>Aufgefrischt wird im Sekundentakt, aber <em>ohne Neuaufbau</em>: die
 * Textfelder bleiben stehen und bekommen neue Texte. Nur wenn sich die
 * Teilnehmer wirklich aendern, werden ihre Zeilen neu gebaut. Auf einem
 * Fernseher ist das der Unterschied zwischen "der Fokus steht" und "der Fokus
 * springt jede Sekunde an den Anfang".
 *
 * <p>Gerechnet wird nichts hier: was dasteht, kommt aus {@link Livestand}, und
 * die Frischegrenze ist die von {@link Mitschaustand}. Ein Geraet, das seit
 * einer halben Minute nichts mehr gemeldet hat, verschwindet - es steht nicht
 * fuer immer als "schaut gerade" da.
 */
final class Livestreifen {

    /** Was der Streifen von der Oberflaeche braucht. */
    interface Umgebung {
        Watchparty watchparty();

        Mitschauen mitschauen();

        /**
         * Ob gerade wirklich vor einer Anbieterseite gesessen wird.
         *
         * <p>Der Streifen gehoert zum Bild. Liegt eine eigene Ansicht darueber -
         * Startseite, Mediathek, Watchparty, Einstellungen -, ist keine Folge
         * offen, und dann gibt es nichts anzuzeigen. Der Takt laeuft trotzdem
         * weiter: eine Seite spaeter ist man wieder da, und ein Streifen, der
         * erst eine Sekunde spaeter erscheint, wirkt wie ein Fehler.
         */
        boolean amSchauen();

        boolean fernseher();

        /** Eine kurze Rueckmeldung - dieselbe wie sonst in der App. */
        void hinweis(String text);
    }

    /** So lange bleiben die Details offen, wenn niemand mehr etwas tut. */
    private static final long ZUKLAPPEN_MS = 12000;
    /**
     * Der Rueckfall, falls der Player nie sagt, ob seine Leiste steht.
     *
     * <p>Er greift nur, solange kein einziger Bericht angekommen ist. Sobald
     * einer da war, gilt allein der - ein Zeitgeber daneben waere die zweite
     * Uhr, die nach ein paar Sekunden anders steht als die des Players.
     */
    private static final long RUECKFALL_RUHE_MS = 3500;
    /** Der Takt, in dem die Uhren nachziehen. Dieselbe Sekunde wie am Rechner. */
    private static final long TAKT_MS = 1000;

    private final Context context;
    private final Umgebung umgebung;
    private final Handler haupt = new Handler(Looper.getMainLooper());

    private final LinearLayout wurzel;
    private final LinearLayout kopf;
    private final TextView punkt;
    private final TextView zeile;
    private final TextView kurz;
    private final TextView pfeil;
    private final LinearLayout details;
    private final LinearLayout teilnehmer;
    private final LinearLayout aktionen;
    private final TextView fussnote;

    /** Wo der Streifen im Normalbetrieb haengt - dorthin kehrt er aus dem Vollbild zurueck. */
    private ViewGroup zuhause;
    private boolean offen;
    private boolean sichtbar;
    /** Ob gerade privat geschaut wird, obwohl der Titel in einer Runde steht. */
    private boolean privat;
    private boolean laeuft;
    /* ------------------------------------- Im Vollbild: mit der Steuerung */
    /*
     * Der Streifen liegt im Vollbild ueber dem Video. Dort darf er nicht
     * dauerhaft stehen - und er soll auch nicht nach eigenem Zeitplan kommen
     * und gehen, sondern genau dann, wenn der Player seine eigenen
     * Bedienelemente zeigt. Der Player meldet das selbst (JW Player, den VOE
     * fuehrt, setzt beim Ausblenden eine Klasse an seinem Wurzelknoten); die
     * Meldung kommt ueber {@link Mitschauen} hier an.
     *
     * Solange von dort nichts kommt - ein Hoster ohne erkennbare Leiste, ein
     * Rahmen, in den kein Skript kommt -, zaehlt die Regung: nach kurzer Ruhe
     * verschwindet der Streifen, jede Beruehrung und jeder Tastendruck holt ihn
     * zurueck. Das ist der Rueckfall, nicht die Regel.
     */
    /** Ob der Streifen gerade im Vollbild-Rahmen haengt. */
    private boolean imVollbild;
    /** Ob der Streifen gerade zu sehen sein soll. */
    private boolean steuerungAn = true;
    /** Was der Player zuletzt gesagt hat. Darauf faellt eine Regung wieder zurueck. */
    private boolean gemeldetAn = true;
    /** Ob der Player ueberhaupt jemals etwas gesagt hat. */
    private boolean steuerungGemeldet;
    /**
     * Nach einer Regung zurueck zu dem, was der Player sagt.
     *
     * <p>Nicht "verbergen": eine Beruehrung ist eine Ausnahme auf Zeit, kein
     * neuer Zustand. Danach gilt wieder der Player - und solange der noch nichts
     * gesagt hat, gilt "weg". Ohne diesen Rueckweg blieb der Streifen nach einem
     * Tipp stehen, weil der Player nur <em>Aenderungen</em> meldet und seine
     * naechste Meldung dieselbe wie die letzte gewesen waere.
     */
    private final Runnable rueckfallVerbergen = () -> {
        boolean ziel = steuerungGemeldet && gemeldetAn;
        if (steuerungAn == ziel) return;
        steuerungAn = ziel;
        if (!ziel) setzeOffen(false);
        steuerungAnwenden();
    };
    /** Woran erkannt wird, dass sich die Teilnehmer wirklich geaendert haben. */
    private String teilnehmerMarke = "";

    /**
     * Wer beim letzten Aufbau schon dabei war.
     *
     * <p>Der Unterschied zwischen "die Liste ist neu" und "es ist jemand
     * dazugekommen". Nur der Dazugekommene bewegt sich.
     */
    private java.util.Set<String> letzteIds = new java.util.HashSet<>();
    private final List<Livestand.Marke> letzteMarken = new ArrayList<>();

    private final Runnable takt = new Runnable() {
        @Override
        public void run() {
            auffrischen();
            if (laeuft) haupt.postDelayed(this, TAKT_MS);
        }
    };
    private final Runnable zuklappen = () -> setzeOffen(false);

    Livestreifen(Context context, Umgebung umgebung) {
        this.context = context;
        this.umgebung = umgebung;
        boolean tv = umgebung.fernseher();

        wurzel = new LinearLayout(context);
        wurzel.setOrientation(LinearLayout.VERTICAL);
        wurzel.setVisibility(View.GONE);
        // Deckend, nicht durchscheinend: im Vollbild liegt er auf dem Video,
        // und ein halbdurchsichtiger Streifen ueber wechselnden Bildern ist
        // genau dann unlesbar, wenn man ihn braucht.
        wurzel.setBackgroundColor(Color.parseColor("#EC0B1220"));

        // --- Die eine Zeile, die immer dasteht -------------------------------
        kopf = new LinearLayout(context);
        kopf.setOrientation(LinearLayout.HORIZONTAL);
        kopf.setGravity(Gravity.CENTER_VERTICAL);
        int rand = dp(tv ? 18 : 12);
        kopf.setPadding(rand, dp(tv ? 8 : 6), rand, dp(tv ? 8 : 6));
        kopf.setFocusable(true);
        kopf.setFocusableInTouchMode(false);
        kopf.setClickable(true);
        // Auf dem Fernseher muss man sehen, worauf der Fokus steht. Auf dem
        // Telefon gibt es keinen Fokus, dort waere ein Rahmen nur Unruhe.
        if (tv) {
            TvViews.applyFocus(kopf,
                MobileViews.shape(context, Color.parseColor("#EC0B1220"), 0, Color.TRANSPARENT, 0),
                MobileViews.shape(context, Theme.PRIMARY_MUTED, 0, Theme.PRIMARY, 2));
        }
        kopf.setOnClickListener(v -> setzeOffen(!offen));
        wurzel.addView(kopf, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        punkt = new TextView(context);
        punkt.setText("●");
        punkt.setTextSize(tv ? 13 : 11);
        punkt.setTextColor(Theme.PRIMARY);
        punkt.setPadding(0, 0, dp(8), 0);
        kopf.addView(punkt);

        zeile = new TextView(context);
        zeile.setTextColor(Theme.TEXT_PRIMARY);
        zeile.setTextSize(tv ? 15 : 13);
        zeile.setTypeface(Typeface.DEFAULT_BOLD);
        zeile.setMaxLines(1);
        zeile.setEllipsize(android.text.TextUtils.TruncateAt.END);
        kopf.addView(zeile, new LinearLayout.LayoutParams(
            0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        kurz = new TextView(context);
        kurz.setTextColor(Theme.TEXT_SECONDARY);
        kurz.setTextSize(tv ? 14 : 12);
        kurz.setMaxLines(1);
        kurz.setPadding(dp(10), 0, dp(8), 0);
        kopf.addView(kurz);

        pfeil = new TextView(context);
        pfeil.setText("▾");
        pfeil.setTextColor(Theme.TEXT_SECONDARY);
        pfeil.setTextSize(tv ? 14 : 12);
        kopf.addView(pfeil);

        // --- Was erst beim Ausklappen dazukommt ------------------------------
        details = new LinearLayout(context);
        details.setOrientation(LinearLayout.VERTICAL);
        details.setVisibility(View.GONE);
        details.setPadding(rand, 0, rand, dp(tv ? 12 : 10));
        wurzel.addView(details, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        // Scrollbar, weil eine Runde beliebig viele Geraete haben darf und ein
        // Telefon im Quermodus wenig Hoehe hat.
        android.widget.ScrollView rolle = new android.widget.ScrollView(context);
        rolle.setVerticalScrollBarEnabled(false);
        teilnehmer = new LinearLayout(context);
        teilnehmer.setOrientation(LinearLayout.VERTICAL);
        rolle.addView(teilnehmer, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        details.addView(rolle, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(tv ? 140 : 110)));

        aktionen = new LinearLayout(context);
        aktionen.setOrientation(LinearLayout.HORIZONTAL);
        aktionen.setClipChildren(false);
        aktionen.setClipToPadding(false);
        LinearLayout.LayoutParams aktionenParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        aktionenParams.topMargin = dp(8);
        details.addView(aktionen, aktionenParams);

        // Einmal gebaut und nicht bei jeder Auffrischung: sonst stapeln sich
        // die Zeilen. Ohne diesen Hinweis liest sich "Live verlassen" wie
        // "Raum aufloesen" - und das ist es ausdruecklich nicht.
        fussnote = new TextView(context);
        fussnote.setText("„Live verlassen“ beendet nur die Teilnahme an dieser Folge. "
            + "Der Titel bleibt im Raum, dein Fortschritt bleibt stehen.");
        fussnote.setTextColor(Theme.TEXT_DISABLED);
        fussnote.setTextSize(tv ? 13 : 11);
        LinearLayout.LayoutParams fussParams = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        fussParams.topMargin = dp(6);
        details.addView(fussnote, fussParams);
    }

    /** Der Streifen selbst - der Aufrufer haengt ihn ein, wo er hingehoert. */
    View ansicht() {
        return wurzel;
    }

    /** Wo er im Normalbetrieb haengt. Wird einmal beim Aufbau gesetzt. */
    void setzeZuhause(ViewGroup halter) {
        zuhause = halter;
    }

    /* ----------------------------------------------------------- Der Takt */

    /**
     * Anfangen oder aufhoeren, im Sekundentakt nachzuziehen.
     *
     * <p>Nur waehrend wirklich jemand vor einer Anbieterseite sitzt. Ein Takt,
     * der auf der Startseite weiterlaeuft, kostet Strom fuer nichts.
     */
    void starten(boolean an) {
        if (laeuft == an) return;
        laeuft = an;
        haupt.removeCallbacks(takt);
        if (an) haupt.post(takt);
        else verbergen();
    }

    private void verbergen() {
        sichtbar = false;
        privat = false;
        offen = false;
        details.setVisibility(View.GONE);
        wurzel.setVisibility(View.GONE);
        haupt.removeCallbacks(zuklappen);
        haupt.removeCallbacks(rueckfallVerbergen);
    }

    /* ------------------------------------- Im Vollbild: mit der Steuerung */

    /**
     * Der Player sagt, ob seine Bedienelemente zu sehen sind.
     *
     * <p>Ab der ersten Meldung gilt nur noch sie. Der Rueckfall ueber die
     * Regung faellt damit weg - er war nur da, solange niemand etwas sagte.
     */
    /**
     * Ein neuer Player - was der alte gemeldet hat, gilt nicht mehr.
     *
     * <p>Ohne das behielte ein Hoster ohne erkennbare Leiste die Auskunft des
     * vorigen: der Streifen bliebe stehen, weil einmal jemand "sichtbar"
     * gesagt hat, und der Rueckfall griffe nie wieder.
     */
    void playerNeu() {
        steuerungGemeldet = false;
        gemeldetAn = true;
        steuerungAn = true;
        haupt.removeCallbacks(rueckfallVerbergen);
        if (imVollbild) haupt.postDelayed(rueckfallVerbergen, RUECKFALL_RUHE_MS);
        steuerungAnwenden();
    }

    void steuerungSichtbar(boolean an) {
        steuerungGemeldet = true;
        gemeldetAn = an;
        haupt.removeCallbacks(rueckfallVerbergen);
        if (steuerungAn == an) return;
        steuerungAn = an;
        if (!an) setzeOffen(false);
        steuerungAnwenden();
    }

    /**
     * Jemand hat etwas getan - Beruehrung, D-Pad, Fernbedienung.
     *
     * <p>Der Streifen kommt zurueck. Solange der Player nichts meldet, ist das
     * zugleich der Anfang der Ruhezeit, nach der er wieder verschwindet; sobald
     * er meldet, ist es nur noch eine Anregung, und sein naechster Bericht
     * entscheidet.
     */
    void regung() {
        haupt.removeCallbacks(rueckfallVerbergen);
        // Immer mit Rueckweg. Auch wenn der Player mitredet: er meldet nur
        // Aenderungen, und "ich zeige meine Leiste" hat er womoeglich schon
        // vor dieser Beruehrung gesagt. Ohne den Rueckweg bliebe der Streifen
        // dann bis in alle Ewigkeit stehen.
        haupt.postDelayed(rueckfallVerbergen, RUECKFALL_RUHE_MS);
        if (steuerungAn) return;
        steuerungAn = true;
        steuerungAnwenden();
    }

    /**
     * Sichtbarkeit anwenden.
     *
     * <p>Ausserhalb des Vollbilds steht der Streifen wie bisher: er liegt dort
     * neben dem Bild und verdeckt nichts. Im Vollbild liegt er darauf - und
     * dort gilt die Steuerung des Players.
     */
    private void steuerungAnwenden() {
        wurzel.setVisibility(zeigen(sichtbar, imVollbild, steuerungAn) ? View.VISIBLE : View.GONE);
    }

    /**
     * Die Regel selbst - ohne Ansicht, damit sie sich pruefen laesst.
     *
     * <p>Ausserhalb des Vollbilds steht der Streifen neben dem Bild und
     * verdeckt nichts; dort haengt er allein daran, ob es ueberhaupt etwas zu
     * zeigen gibt. Im Vollbild liegt er auf dem Video - und dort gilt, was der
     * Player ueber seine eigenen Bedienelemente sagt.
     */
    static boolean zeigen(boolean etwasZuZeigen, boolean imVollbild, boolean steuerungAn) {
        return etwasZuZeigen && (!imVollbild || steuerungAn);
    }

    /**
     * Alles nachziehen - ohne die Ansicht neu zu bauen.
     *
     * <p>Genau das ist der Punkt: die Textfelder bleiben stehen und bekommen
     * neue Texte. Nur wenn sich die Teilnehmer wirklich aendern, werden ihre
     * Zeilen neu gebaut. Sonst faenge auf dem Fernseher der Fokus jede Sekunde
     * von vorn an.
     */
    void auffrischen() {
        Watchparty watchparty = umgebung.watchparty();
        Mitschauen mitschauen = umgebung.mitschauen();
        if (watchparty == null || mitschauen == null || !umgebung.amSchauen()
            || !watchparty.istEingeschaltet() || !mitschauen.stehtInRunde()) {
            if (sichtbar || wurzel.getVisibility() != View.GONE) verbergen();
            return;
        }

        // Es gibt genau zwei Zustaende, wie am Rechner: privat oder live in
        // einer Runde. Der Streifen steht in beiden - er sagt ja gerade, welcher
        // von beiden gilt, und ist zugleich der Weg, das umzustellen.
        if (!mitschauen.laeuftMit()) {
            privatZeigen();
            return;
        }

        String raum = mitschauen.aktiverRaum();
        String key = mitschauen.aktiverSchluessel();
        String kartenSchluessel = Mitschaustand.schluessel(key, raum);
        JSONArray mitglieder = watchparty.mitgliederZu(kartenSchluessel);
        double seit = watchparty.sekundenSeitMeldung(kartenSchluessel);
        int[] folge = mitschauen.offeneFolge();
        List<Livestand.Marke> marken = Livestand.marken(mitglieder, seit, folge[0], folge[1]);

        boolean verbunden = watchparty.istVerbunden();
        // Der Raum steht nur dabei, wenn es mehr als einen gibt - sonst ist es
        // eine Auskunft ueber nichts. Dieselbe Regel wie am Rechner.
        String raumText = watchparty.raeume().length() > 1 ? raum : "";
        // Eine gerade geschehene Tat geht vor - sie ist die Auskunft, auf die
        // man in dem Augenblick wartet. Sie faellt nach sechs Sekunden von
        // selbst wieder auf den bestaetigten Stand zurueck, genau wie am
        // Rechner.
        String zwischenruf = verbunden
            ? Livestand.zwischenruf(watchparty.letzteAktion(kartenSchluessel),
                watchparty.seitLetzterAktion(kartenSchluessel))
            : "";
        String kopfText = zwischenruf.isEmpty()
            ? Livestand.kopfzeile(marken, watchparty.pausiertVon(kartenSchluessel),
                raumText, verbunden, false, 0)
            : zwischenruf;

        sichtbar = true;
        steuerungAnwenden();
        zeile.setText(kopfText);
        // Grün heisst: die Runde laeuft. Gelb: sie steht. Rot: die Leitung ist
        // weg. Drei Zustaende, drei Farben - eine Zeile allein liest niemand im
        // Vorbeigehen.
        punkt.setTextColor(!verbunden ? Color.parseColor("#E5484D")
            : Livestand.stehtStill(marken) ? Color.parseColor("#F5B84B")
                : Color.parseColor("#3DD68C"));
        kurz.setText(Livestand.zusammenfassung(marken));

        privat = false;
        letzteMarken.clear();
        letzteMarken.addAll(marken);
        if (offen) detailsFuellen(marken);
    }

    /**
     * Privat: diese Folge steht in einer Runde, zaehlt aber gerade nur hier.
     *
     * <p>Derselbe Zustand wie am Rechner, wo die Anzeige dann "Privat" heisst
     * und der Knopf "Live beitreten". Er ist kein Fehler und keine Warnung -
     * er ist eine Auskunft, und er laesst sich mit einem Griff umstellen.
     */
    private void privatZeigen() {
        sichtbar = true;
        privat = true;
        steuerungAnwenden();
        punkt.setTextColor(Theme.TEXT_DISABLED);
        zeile.setText("Privat");
        String raum = umgebung.mitschauen().eingestellterRaum();
        kurz.setText(raum.isEmpty() ? "zählt nur für dich" : "zählt nur für dich · " + raum);
        letzteMarken.clear();
        if (offen) detailsFuellen(letzteMarken);
    }

    /* ------------------------------------------------------- Die Details */

    private void setzeOffen(boolean auf) {
        if (!sichtbar) auf = false;
        offen = auf;
        // Ein Zeichen, das sich dreht, statt zweier, die sich abwechseln.
        pfeil.setText("▾");
        long dreh = Bewegung.dauer(context, Bewegung.LANG);
        if (dreh > 0) {
            pfeil.animate().rotation(auf ? 180f : 0f)
                .setDuration(dreh).setInterpolator(Bewegung.feder(0.4f)).start();
        } else {
            pfeil.setRotation(auf ? 180f : 0f);
        }
        // Auf- und zuklappen statt erscheinen und verschwinden. Der Streifen
        // sitzt ueber dem Video; was dort aufgeht, soll aufgehen und nicht
        // dastehen.
        Bewegung.klappen(details, auf, null);
        haupt.removeCallbacks(zuklappen);
        if (!auf) {
            teilnehmerMarke = "";
            return;
        }
        detailsFuellen(letzteMarken);
        // Von selbst wieder zusammen. Ein Streifen, der offen stehen bleibt,
        // ist im Vollbild genau das grosse Overlay, das hier niemand will.
        haupt.postDelayed(zuklappen, ZUKLAPPEN_MS);
    }

    /** Ob die Details gerade offen sind - die Zurueck-Taste fragt danach. */
    boolean istOffen() {
        return offen && sichtbar;
    }

    /**
     * Zurueck schliesst zuerst die Details.
     *
     * <p>Und nicht gleich die ganze Watchparty. Wer auf dem Fernseher OK
     * drueckt, um zu sehen, wer mitschaut, will mit Zurueck genau das wieder
     * schliessen - nicht die Folge verlassen.
     *
     * @return ob die Taste hier verbraucht wurde
     */
    boolean zurueck() {
        if (!istOffen()) return false;
        setzeOffen(false);
        return true;
    }

    /** Den Fokus auf den Streifen holen - der Weg dorthin mit der Fernbedienung. */
    boolean fokussieren() {
        if (!sichtbar) return false;
        return kopf.requestFocus();
    }

    /** Ob die Fernbedienung gerade auf dem Streifen steht. */
    boolean hatFokus() {
        return sichtbar && (kopf.hasFocus() || wurzel.hasFocus());
    }

    private void detailsFuellen(List<Livestand.Marke> marken) {
        // Nur neu bauen, wenn sich wirklich etwas an der Besetzung geaendert
        // hat. Die Uhren wechseln jede Sekunde; die Zeilen dafuer neu zu bauen
        // hiesse, den Fokus jede Sekunde wegzunehmen.
        // Der Zustand gehoert in den Merker. Sonst sieht ein Wechsel von live
        // auf privat wie "dieselbe leere Liste" aus, und die Zeilen der Runde
        // von eben blieben stehen.
        StringBuilder marke = new StringBuilder(privat ? "privat|" : "live|");
        for (Livestand.Marke person : marken) {
            marke.append(person.id).append(person.host ? "!" : "").append("|");
        }
        boolean neuBauen = !marke.toString().equals(teilnehmerMarke);
        teilnehmerMarke = marke.toString();
        java.util.HashSet<String> jetzt = new java.util.HashSet<>();
        for (Livestand.Marke person : marken) jetzt.add(person.id);

        if (neuBauen) {
            teilnehmer.removeAllViews();
            for (int i = 0; i < marken.size(); i += 1) {
                // Wer schon dabei war, steht einfach da; wer dazugekommen ist,
                // kommt mit einem Popp. Ohne diese Unterscheidung huepfte die
                // ganze Besetzung, sobald ein einziges Geraet dazustoesst.
                boolean neu = !letzteIds.contains(marken.get(i).id);
                TextView text = new TextView(context);
                if (neu) Bewegung.hereinPoppen(text);
                text.setTextColor(marken.get(i).ich ? Theme.TEXT_PRIMARY : Theme.TEXT_SECONDARY);
                text.setTextSize(umgebung.fernseher() ? 15 : 13);
                text.setMaxLines(1);
                text.setEllipsize(android.text.TextUtils.TruncateAt.END);
                text.setPadding(0, dp(3), 0, dp(3));
                teilnehmer.addView(text);
            }
            aktionenBauen();
        }
        for (int i = 0; i < marken.size() && i < teilnehmer.getChildCount(); i += 1) {
            View kind = teilnehmer.getChildAt(i);
            if (!(kind instanceof TextView)) continue;
            Livestand.Marke person = marken.get(i);
            ((TextView) kind).setText(Livestand.zeile(person));
            ((TextView) kind).setTextColor(person.hinterher ? Color.parseColor("#F5B84B")
                : person.ich ? Theme.TEXT_PRIMARY : Theme.TEXT_SECONDARY);
        }
        letzteIds = jetzt;
        if (marken.isEmpty() && teilnehmer.getChildCount() == 0) {
            TextView leer = new TextView(context);
            leer.setText(privat
                ? "Was du hier schaust, zählt gerade nur für dich."
                : "Hier schaut gerade niemand sonst mit.");
            leer.setTextColor(Theme.TEXT_DISABLED);
            leer.setTextSize(umgebung.fernseher() ? 15 : 13);
            teilnehmer.addView(leer);
        }
    }

    /**
     * Die drei Aktionen des Rechners - abgleichen, weitergeben, verlassen.
     *
     * <p>Sie stehen im ausgeklappten Zustand und nicht im Streifen: auf einem
     * Fernseher waere jeder davon sonst eine weitere Station auf dem Weg zum
     * Bild, und im Vollbild lagen sie ueber dem Video.
     */
    private void aktionenBauen() {
        aktionen.removeAllViews();
        Mitschauen mitschauen = umgebung.mitschauen();
        if (mitschauen == null) return;

        if (privat) {
            fussnote.setText("Dieser Titel läuft in einer Watchparty, gezählt wird der Stand "
                + "gerade aber nur für dich.");
            knopfAnhaengen("Live beitreten", true, () -> mitschauen.liveBeitreten((wert, fehler) -> {
                if (fehler != null) umgebung.hinweis("Ging nicht: " + fehler);
                else umgebung.hinweis("Live dabei — ihr schaut gemeinsam");
                setzeOffen(false);
                auffrischen();
            }));
            return;
        }
        fussnote.setText("„Live verlassen“ beendet nur die Teilnahme an dieser Folge. "
            + "Der Titel bleibt im Raum, dein Fortschritt bleibt stehen.");

        knopfAnhaengen("Mit Host abgleichen", true, () -> {
            Livestand.Marke ich = mich();
            // Die eigene Stelle mitschicken, damit das Relay weiss, wo dieses
            // Geraet steht. Sie entscheidet nichts - der Host gibt das Ziel
            // vor -, aber ohne sie faengt der gemeinsame Start bei null an.
            mitschauen.gleichziehen(ich == null ? 0 : ich.sekunde);
            umgebung.hinweis("Alle werden abgeglichen …");
            haupt.removeCallbacks(zuklappen);
            haupt.postDelayed(zuklappen, 2000);
        });

        // Weitergeben kann nur, wer den Takt hat - und nur, wenn jemand da ist.
        Livestand.Marke ich = mich();
        boolean binHost = ich != null && ich.host;
        if (binHost && andere().size() > 0) {
            knopfAnhaengen("Host weitergeben", false, this::hostWaehlen);
        }

        knopfAnhaengen("Live verlassen", false, () -> {
            mitschauen.liveVerlassen((wert, fehler) -> {
                if (fehler != null) umgebung.hinweis("Ging nicht: " + fehler);
                else umgebung.hinweis("Zählt jetzt nur für dich — der Stand bleibt privat");
            });
            setzeOffen(false);
            auffrischen();
        });
    }

    private void knopfAnhaengen(String beschriftung, boolean haupt2, Runnable tat) {
        boolean tv = umgebung.fernseher();
        View knopf = tv
            ? (haupt2 ? TvViews.hauptPillButton(context, beschriftung, () -> tatMitRuhe(tat))
                : TvViews.pillButton(context, beschriftung, () -> tatMitRuhe(tat)))
            : (haupt2 ? MobileViews.primaryButton(context, beschriftung, () -> tatMitRuhe(tat))
                : MobileViews.secondaryButton(context, beschriftung, () -> tatMitRuhe(tat)));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            0, tv ? ViewGroup.LayoutParams.WRAP_CONTENT : dp(MobileViews.TOUCH_TARGET), 1);
        if (aktionen.getChildCount() > 0) params.leftMargin = dp(8);
        aktionen.addView(knopf, params);
    }

    /** Jede Bedienung haelt den Streifen offen - sonst klappt er unter der Hand zu. */
    private void tatMitRuhe(Runnable tat) {
        haupt.removeCallbacks(zuklappen);
        haupt.postDelayed(zuklappen, ZUKLAPPEN_MS);
        tat.run();
    }

    private void hostWaehlen() {
        List<Livestand.Marke> andere = andere();
        if (andere.isEmpty()) {
            umgebung.hinweis("Gerade schaut niemand sonst mit");
            return;
        }
        android.widget.PopupMenu menue = new android.widget.PopupMenu(context, kopf);
        java.util.LinkedHashMap<String, String> ziele = new java.util.LinkedHashMap<>();
        for (Livestand.Marke person : andere) {
            if (person.id.isEmpty()) continue;
            ziele.put("Host an " + person.name + " weitergeben", person.id);
        }
        if (ziele.isEmpty()) {
            umgebung.hinweis("Gerade schaut niemand sonst mit");
            return;
        }
        for (String beschriftung : ziele.keySet()) menue.getMenu().add(beschriftung);
        menue.setOnMenuItemClickListener(punktImMenue -> {
            String beschriftung = String.valueOf(punktImMenue.getTitle());
            String id = ziele.get(beschriftung);
            Mitschauen mitschauen = umgebung.mitschauen();
            if (id == null || mitschauen == null) return true;
            mitschauen.hostUebergeben(id, (wert, fehler) -> {
                if (fehler != null) umgebung.hinweis("Ging nicht: " + fehler);
                else umgebung.hinweis(beschriftung.replace("Host an ", "Host an ")
                    .replace(" weitergeben", " weitergegeben"));
            });
            return true;
        });
        menue.show();
    }

    private Livestand.Marke mich() {
        for (Livestand.Marke marke : letzteMarken) {
            if (marke.ich) return marke;
        }
        return null;
    }

    private List<Livestand.Marke> andere() {
        List<Livestand.Marke> liste = new ArrayList<>();
        for (Livestand.Marke marke : letzteMarken) {
            if (!marke.ich) liste.add(marke);
        }
        return liste;
    }

    /* ------------------------------------------------------------ Vollbild */

    /**
     * In den Vollbild-Rahmen umziehen - und wieder zurueck.
     *
     * <p>Im Vollbild liegt das Video in einem eigenen Rahmen auf der
     * Fensterdekoration, weit ueber der App. Ein Streifen, der unten in der
     * Oberflaeche haengen bleibt, waere dort schlicht nicht zu sehen. Also
     * zieht er mit - oben, schmal, und ohne den Fokus des Players zu nehmen.
     *
     * @param rahmen der Vollbild-Rahmen, oder {@code null} zum Zurueckziehen
     */
    void inVollbild(FrameLayout rahmen) {
        if (wurzel.getParent() instanceof ViewGroup) {
            ((ViewGroup) wurzel.getParent()).removeView(wurzel);
        }
        // Ausgeklappt in ein Vollbild zu wandern hiesse, dem Video einen Kasten
        // vor die Nase zu stellen. Er faengt dort zusammengeklappt an.
        setzeOffen(false);
        imVollbild = rahmen != null;
        // Beim Eintreten erst einmal da: die Bedienelemente des Players sind in
        // diesem Augenblick fast immer offen, und ein Streifen, der gar nicht
        // erst erscheint, sieht aus wie einer, der fehlt. Es ist dieselbe
        // Ausnahme auf Zeit wie bei einer Beruehrung - was danach gilt, sagt
        // der Player.
        steuerungAn = true;
        haupt.removeCallbacks(rueckfallVerbergen);
        if (imVollbild) haupt.postDelayed(rueckfallVerbergen, RUECKFALL_RUHE_MS);
        steuerungAnwenden();
        if (rahmen != null) {
            FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.gravity = Gravity.TOP;
            rahmen.addView(wurzel, params);
            wurzel.bringToFront();
            return;
        }
        if (zuhause != null) {
            zuhause.addView(wurzel, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
    }

    private int dp(int wert) {
        return Math.round(wert * context.getResources().getDisplayMetrics().density);
    }
}
