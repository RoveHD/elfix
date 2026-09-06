package local.elflix.android;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.ShapeDrawable;
import android.graphics.drawable.shapes.OvalShape;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Consumer;
import org.json.JSONObject;

/**
 * Die Wiedergabeflaeche ohne Hoster-Dokument - fuer Finger und fuer das Steuerkreuz.
 *
 * <p><b>Die Bedienung ist die des Rechners.</b> Vorher stand hier der mitgelieferte
 * Bedienteil von media3, darueber eine Zeile grauer Systemknoepfe mit rotem
 * Fokusrand - drei Gestaltungen in einem Bild, von denen keine die der App war.
 * Jetzt zeichnet diese Klasse ihre Bedienung selbst, mit denselben Mitteln wie
 * {@code src/renderer/spieler.html}: zwei Schichten, die zusammen kommen und
 * gehen (Kopf oben, Leiste unten), ein Fortschrittsbalken in drei Zonen
 * (gespielt, geladen, Rest), Knoepfe ohne Flaeche bis sie gedrueckt oder
 * angesteuert werden, und die Blende von rechts fuer jede Liste.
 *
 * <p><b>Gleich heisst nicht abgemalt.</b> Zwei Dinge des Rechners fehlen mit
 * Absicht: der Lautstaerkeregler (dafuer hat ein Telefon Tasten, und eine
 * Fernbedienung erst recht) und der Vollbildknopf (hier ist immer Vollbild).
 * Dafuer sind alle Ziele mindestens 48 dp hoch, und jeder Knopf traegt einen
 * sichtbaren Fokuszustand - ohne den ist am Fernseher nicht zu erkennen, worauf
 * das Steuerkreuz gerade zeigt.
 *
 * <p>Alles unterhalb der Gestaltung - Quelle, Takt, Fortschritt, Watchparty,
 * Intro-Marke - ist unveraendert: die Wiedergabe wusste nie, wie sie aussieht.
 */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class DirektSpieler {
    interface Umgebung {
        void schliessen();
        /** Die Fassungen dieser Folge - Deutsch, Untertitel-Fassung, ... */
        void fassungen();
        /** Die Hoster der laufenden Fassung. Getrennt von ihr, wie am Rechner. */
        void hoster();
        void folgen();
        void naechste();
        void stand(JSONObject wert);
        void live(JSONObject wert, String aktion);
        void bereit();
        boolean darfAutoplay();
        void marke(Consumer<JSONObject> fertig);
        void sprung(double von, double nach);
        /**
         * Die Bedienung ist gekommen oder gegangen.
         *
         * <p>Der Live-Streifen haengt daran: er zeigt sich mit den
         * Bedienelementen und verschwindet mit ihnen. Ohne diese Meldung
         * stuende er entweder dauerhaft ueber dem Bild oder gar nicht.
         */
        default void bedienung(boolean sichtbar) { }
    }

    /* --------------------------------------------------- Die Farben des Players */

    /** Der Grund hinter dem Bild - derselbe Wert wie im Player am Rechner. */
    private static final int GRUND = Color.parseColor("#05070C");
    /** Die Flaeche der Blende: fast deckend, damit Text darauf ruhig steht. */
    private static final int BLENDE = Color.parseColor("#F2080B12");
    private static final int KARTE = Color.parseColor("#DB0C1018");
    private static final int SCHRIFT = Color.WHITE;
    /** Zweite Zeile, Zeiten, Beschreibungen. */
    private static final int SCHRIFT_LEISE = 0xB3FFFFFF;
    private static final int SCHRIFT_STILL = 0x99FFFFFF;
    /** Knopf unter dem Finger beziehungsweise unter der Maus am Rechner. */
    private static final int KNOPF_DRUCK = 0x24FFFFFF;
    /** Eine Zeile in einer Liste - dieselben sechs Prozent wie drueben. */
    private static final int ZEILE = 0x0FFFFFFF;
    private static final int ZEILE_DRUCK = 0x29FFFFFF;
    private static final int SPUR = 0x38FFFFFF;
    private static final int SPUR_GELADEN = 0x6BFFFFFF;
    private static final int RAHMEN = 0x47FFFFFF;

    /** Wie lange die Schichten stehenbleiben, wenn nichts geschieht. */
    private static final long RUHE_MS = 5000;
    /**
     * Ab wann die Karte zur naechsten Folge dasteht.
     *
     * <p>Dieselbe Schwelle wie am Rechner (NEXT_EPISODE_PROMPT_PERCENT in
     * main.js, im Auftrag als `weiterAbProzent`). Vorher stand die Karte auf
     * Android von der ersten Sekunde an ueber dem Bild: ein Knopf, der eine
     * Folge lang anbietet, sie zu ueberspringen.
     */
    private static final int WEITER_AB_PROZENT = 90;

    private final Activity activity;
    private final Kern kern;
    private final Umgebung umgebung;
    final FrameLayout ansicht;
    private final PlayerView bild;

    private final View kopf;
    /** Der Platz fuer den Live-Streifen der Runde - gefuellt wird er von aussen. */
    private FrameLayout streifenPlatz;
    private final TextView titel;
    private final TextView quellenname;
    private final View leiste;
    private final TextView stelleText;
    private final TextView dauerText;
    private final SeekBar regler;
    private final TextView spielen;
    private final ImageView ton;
    private final TextView automatisch;
    private final TextView intro;

    private final LinearLayout mitte;
    private final ProgressBar puffer;
    private final LinearLayout kasten;
    private final TextView hinweis;
    private final LinearLayout kastenKnoepfe;

    private final LinearLayout weiterKarte;
    private final TextView weiterOben;
    private final TextView weiterTitel;

    private final FrameLayout blende;
    private final TextView blendeTitel;
    private final LinearLayout blendeListe;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    private boolean geschlossen;
    private boolean aktiv = true;
    private boolean hatNaechste;
    private boolean endeAbgesagt;
    private long zaehlerEnde;
    private long zuletzt;
    private double gespielt;
    private double letztePosition;
    private long letztesSpeichern;
    private boolean bereitGemeldet;
    private Boolean erwartetPlay;
    private double erwartetSeek = -1;
    private long erwartetBis;
    private boolean quelleLaedt = true;
    private JSONObject introMarke;
    private double introZiel;
    private double sprungVon = -1;
    private double sprungNach;
    private long letzteMarkenFrage;
    private Befehl wartenderBefehl;

    /** Schichten sichtbar? Steht hier und nicht an der Sichtbarkeit der Ansicht:
     *  waehrend des Ausblendens ist sie noch sichtbar und schon nicht mehr gemeint. */
    private boolean schichtenAn = true;
    private boolean reglerGefasst;
    private boolean warSichtbar;
    private String naechsterTitel = "";

    /**
     * Eine Reihe, die umbricht, statt zu schieben.
     *
     * <p>Android bringt so etwas nicht mit - die Flexbox liegt in einer eigenen
     * Bibliothek, und fuer zwoelf Knoepfe eine Abhaengigkeit aufzunehmen waere
     * unverhaeltnismaessig. Gemessen und gelegt wird zweimal dieselbe Rechnung:
     * passt das naechste Kind nicht mehr in die Zeile, faengt eine neue an.
     */
    /**
     * Ein Lautsprecher, gezeichnet: Kasten, Trichter und zwei Boegen.
     *
     * <p>Stumm faellt ein Strich darueber - die Boegen bleiben weg. Beides in
     * derselben Helligkeit wie die Schrift daneben, damit der Knopf nicht aus
     * der Zeile faellt.
     */
    private static final class Lautsprecher extends android.graphics.drawable.Drawable {
        private final int mass;
        private final boolean an;
        private final android.graphics.Paint stift =
            new android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG);

        Lautsprecher(int mass, boolean an) {
            this.mass = mass;
            this.an = an;
            stift.setColor(SCHRIFT);
        }

        @Override public int getIntrinsicWidth() { return mass; }
        @Override public int getIntrinsicHeight() { return mass; }

        @Override public void draw(android.graphics.Canvas blatt) {
            float w = mass;
            float h = mass;
            float strich = Math.max(1.5f, mass / 11f);
            stift.setStyle(android.graphics.Paint.Style.FILL);
            android.graphics.Path form = new android.graphics.Path();
            form.moveTo(0.06f * w, 0.36f * h);
            form.lineTo(0.26f * w, 0.36f * h);
            form.lineTo(0.52f * w, 0.12f * h);
            form.lineTo(0.52f * w, 0.88f * h);
            form.lineTo(0.26f * w, 0.64f * h);
            form.lineTo(0.06f * w, 0.64f * h);
            form.close();
            blatt.drawPath(form, stift);

            stift.setStyle(android.graphics.Paint.Style.STROKE);
            stift.setStrokeWidth(strich);
            stift.setStrokeCap(android.graphics.Paint.Cap.ROUND);
            if (an) {
                for (int i = 1; i <= 2; i++) {
                    float radius = (0.16f + 0.16f * i) * w;
                    android.graphics.RectF bogen = new android.graphics.RectF(
                        0.5f * w - radius, 0.5f * h - radius, 0.5f * w + radius, 0.5f * h + radius);
                    blatt.drawArc(bogen, -52f, 104f, false, stift);
                }
                return;
            }
            blatt.drawLine(0.64f * w, 0.34f * h, 0.94f * w, 0.66f * h, stift);
            blatt.drawLine(0.94f * w, 0.34f * h, 0.64f * w, 0.66f * h, stift);
        }

        @Override public void setAlpha(int alpha) { stift.setAlpha(alpha); }
        @Override public void setColorFilter(android.graphics.ColorFilter filter) {
            stift.setColorFilter(filter);
        }
        @Override public int getOpacity() { return android.graphics.PixelFormat.TRANSLUCENT; }
    }

    private static final class Fliessreihe extends ViewGroup {
        private final int spalt;
        private final int zeilenAbstand;

        Fliessreihe(android.content.Context zusammenhang, int spalt, int zeilenAbstand) {
            super(zusammenhang);
            this.spalt = spalt;
            this.zeilenAbstand = zeilenAbstand;
        }

        /**
         * Ein Strich, der zwei Gruppen trennt.
         *
         * <p>Er zaehlt nur, wenn links und rechts von ihm in derselben Zeile
         * etwas steht. Am Zeilenanfang trennt er nichts, und am Zeilenende
         * haengt er im Nichts - beides sah aus wie ein Fehler.
         */
        private static boolean istTrenner(View kind) {
            return "trenner".equals(kind.getTag());
        }

        @Override protected void onMeasure(int breiteVorgabe, int hoeheVorgabe) {
            int breite = MeasureSpec.getSize(breiteVorgabe) - getPaddingLeft() - getPaddingRight();
            // Erst alles messen: die Zeilenaufteilung unten muss vorausschauen
            // koennen, und dafuer braucht sie die Breite des naechsten Kindes.
            for (int i = 0; i < getChildCount(); i++) {
                View kind = getChildAt(i);
                if (kind.getVisibility() == GONE) continue;
                measureChild(kind,
                    MeasureSpec.makeMeasureSpec(breite, MeasureSpec.AT_MOST),
                    MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED));
            }
            int hoehe = verteilen(breite, false);
            setMeasuredDimension(MeasureSpec.getSize(breiteVorgabe),
                hoehe + getPaddingTop() + getPaddingBottom());
        }

        @Override protected void onLayout(boolean geaendert, int links, int oben, int rechts, int unten) {
            verteilen(getWidth() - getPaddingLeft() - getPaddingRight(), true);
        }

        /**
         * Die eine Rechnung, zweimal benutzt: einmal fuer die Hoehe, einmal
         * zum Legen. Zwei getrennte Schleifen waeren zwei Wahrheiten.
         *
         * @return die gebrauchte Hoehe
         */
        private int verteilen(int breite, boolean legen) {
            int x = 0;
            int y = 0;
            int zeileHoch = 0;
            for (int i = 0; i < getChildCount(); i++) {
                View kind = getChildAt(i);
                if (kind.getVisibility() == GONE) continue;
                int kindBreit = kind.getMeasuredWidth();
                int kindHoch = kind.getMeasuredHeight();
                if (x > 0 && x + kindBreit > breite) {
                    x = 0;
                    y += zeileHoch + zeilenAbstand;
                    zeileHoch = 0;
                }
                if (istTrenner(kind) && !trennerZaehlt(i, x, kindBreit, breite)) {
                    if (legen) kind.layout(getPaddingLeft() + x, getPaddingTop() + y,
                        getPaddingLeft() + x, getPaddingTop() + y);
                    continue;
                }
                if (legen) {
                    kind.layout(getPaddingLeft() + x, getPaddingTop() + y,
                        getPaddingLeft() + x + kindBreit, getPaddingTop() + y + kindHoch);
                }
                x += kindBreit + spalt;
                zeileHoch = Math.max(zeileHoch, kindHoch);
            }
            return y + zeileHoch;
        }

        /** Steht links und rechts vom Strich in dieser Zeile noch etwas? */
        private boolean trennerZaehlt(int stelle, int x, int kindBreit, int breite) {
            if (x == 0) return false;
            for (int i = stelle + 1; i < getChildCount(); i++) {
                View naechstes = getChildAt(i);
                if (naechstes.getVisibility() == GONE) continue;
                return x + kindBreit + spalt + naechstes.getMeasuredWidth() <= breite;
            }
            return false;
        }
    }

    private static final class Befehl {
        JSONObject urteil;
        final Runnable bereit;
        boolean rechnet;
        boolean angewendet;
        double ziel;
        Befehl(JSONObject urteil, Runnable bereit) { this.urteil = urteil; this.bereit = bereit; }
    }

    DirektSpieler(Activity activity, Kern kern, Umgebung umgebung) {
        this.activity = activity;
        this.kern = kern;
        this.umgebung = umgebung;

        // Jede Beruehrung haelt die Schichten wach - auch die auf einem Knopf.
        // Ueber dispatchTouchEvent und nicht ueber einen Zuhoerer je Knopf: die
        // Regel gilt fuer die Flaeche, nicht fuer die einzelne Schaltflaeche.
        ansicht = new FrameLayout(activity) {
            @Override public boolean dispatchTouchEvent(MotionEvent ereignis) {
                if (ereignis.getActionMasked() == MotionEvent.ACTION_DOWN) {
                    // Was beim Aufsetzen des Fingers galt, entscheidet weiter
                    // unten der Tipp aufs Bild. Ohne diesen Merker weckt der
                    // Druck die Bedienung, und der Klick darauf nimmt sie
                    // sofort wieder weg - ein Tippen ohne Wirkung.
                    warSichtbar = schichtenAn;
                    regung();
                }
                return super.dispatchTouchEvent(ereignis);
            }
        };
        ansicht.setBackgroundColor(GRUND);
        ansicht.setFocusable(true);

        bild = new PlayerView(activity);
        // Kein mitgelieferter Bedienteil mehr: alles unten in dieser Datei.
        bild.setUseController(false);
        bild.setShowBuffering(PlayerView.SHOW_BUFFERING_NEVER);
        bild.setBackgroundColor(GRUND);
        ansicht.addView(bild, new FrameLayout.LayoutParams(-1, -1));
        // Ein Tippen aufs Bild zeigt die Bedienung und nimmt sie wieder weg -
        // das ist die Geste, die jeder Player auf einem Telefon hat.
        bild.setOnClickListener(v -> {
            if (warSichtbar) schichtenSetzen(false);
        });

        // Oben stehen zwei Dinge untereinander: der Streifen der Runde (er
        // kommt von aussen, siehe streifenPlatz) und der Kopf des Players.
        // Uebereinander gelegt verdeckten sie sich gegenseitig.
        LinearLayout oben = new LinearLayout(activity);
        oben.setOrientation(LinearLayout.VERTICAL);
        streifenPlatz = new FrameLayout(activity);
        oben.addView(streifenPlatz, new LinearLayout.LayoutParams(-1, -2));
        kopf = kopfBauen();
        oben.addView(kopf, new LinearLayout.LayoutParams(-1, -2));
        ansicht.addView(oben, new FrameLayout.LayoutParams(-1, -2, Gravity.TOP));
        titel = kopf.findViewWithTag("titel");
        quellenname = kopf.findViewWithTag("quelle");

        LinearLayout unten = leisteBauen();
        leiste = unten;
        ansicht.addView(unten, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        stelleText = unten.findViewWithTag("stelle");
        dauerText = unten.findViewWithTag("dauer");
        regler = unten.findViewWithTag("regler");
        spielen = unten.findViewWithTag("spielen");
        ton = unten.findViewWithTag("ton");
        automatisch = unten.findViewWithTag("auto");
        intro = unten.findViewWithTag("intro");

        // Kringel und Ansage stehen untereinander in einer Spalte, nicht
        // uebereinander in der Mitte: nebeneinandergelegt dreht sich der Kringel
        // sonst hinter dem Text, und beides ist schlechter zu lesen als jedes
        // fuer sich. Sie beantworten dieselbe Frage - "warum sehe ich nichts?" -
        // und gehoeren deshalb zusammen.
        mitte = new LinearLayout(activity);
        mitte.setOrientation(LinearLayout.VERTICAL);
        mitte.setGravity(Gravity.CENTER);
        mitte.setPadding(dp(24), 0, dp(24), 0);
        puffer = new ProgressBar(activity);
        puffer.setIndeterminate(true);
        puffer.setIndeterminateTintList(ColorStateList.valueOf(Theme.PRIMARY));
        mitte.addView(puffer, new LinearLayout.LayoutParams(dp(46), dp(46)));
        ansicht.addView(mitte, new FrameLayout.LayoutParams(-1, -1, Gravity.CENTER));

        kasten = new LinearLayout(activity);
        kasten.setOrientation(LinearLayout.VERTICAL);
        kasten.setGravity(Gravity.CENTER);
        kasten.setPadding(dp(24), dp(20), dp(24), dp(18));
        kasten.setBackground(flaeche(Color.parseColor("#F00A0E16"), 18, RAHMEN, 1));
        hinweis = new TextView(activity);
        hinweis.setTextColor(SCHRIFT);
        hinweis.setTextSize(15);
        hinweis.setGravity(Gravity.CENTER);
        hinweis.setLineSpacing(dp(3), 1f);
        kasten.addView(hinweis);
        kastenKnoepfe = new LinearLayout(activity);
        kastenKnoepfe.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams knopfReihe = new LinearLayout.LayoutParams(-2, -2);
        knopfReihe.topMargin = dp(12);
        kasten.addView(kastenKnoepfe, knopfReihe);
        LinearLayout.LayoutParams kastenLage = new LinearLayout.LayoutParams(-2, -2);
        kastenLage.topMargin = dp(16);
        mitte.addView(kasten, kastenLage);

        weiterKarte = new LinearLayout(activity);
        weiterKarte.setOrientation(LinearLayout.VERTICAL);
        weiterKarte.setPadding(dp(16), dp(12), dp(18), dp(13));
        weiterKarte.setBackground(flaeche(KARTE, 12, RAHMEN, 1));
        weiterKarte.setVisibility(View.GONE);
        weiterOben = new TextView(activity);
        weiterOben.setText("Nächste Folge");
        weiterOben.setTextColor(SCHRIFT);
        weiterOben.setTextSize(15);
        weiterOben.setTypeface(Typeface.DEFAULT_BOLD);
        weiterKarte.addView(weiterOben);
        weiterTitel = new TextView(activity);
        weiterTitel.setTextColor(SCHRIFT_LEISE);
        weiterTitel.setTextSize(12);
        weiterTitel.setSingleLine(true);
        weiterTitel.setEllipsize(android.text.TextUtils.TruncateAt.END);
        weiterKarte.addView(weiterTitel);
        FrameLayout.LayoutParams karteLage =
            new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.END);
        karteLage.rightMargin = dp(26);
        karteLage.bottomMargin = dp(112);
        ansicht.addView(weiterKarte, karteLage);
        anfassbar(weiterKarte, 12, umgebung::naechste);

        blende = blendeBauen();
        ansicht.addView(blende, new FrameLayout.LayoutParams(-2, -1, Gravity.END));
        blendeTitel = blende.findViewWithTag("titel");
        blendeListe = blende.findViewWithTag("liste");

        status("Direktquellen werden geladen …");
        handler.post(takt);
        handler.post(balken);
        regung();
    }

    /* ------------------------------------------------------------- Der Aufbau */

    private View kopfBauen() {
        LinearLayout reihe = new LinearLayout(activity);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER_VERTICAL);
        reihe.setPadding(dp(18), dp(14), dp(18), dp(22));
        reihe.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { 0xB8000000, 0x00000000 }));

        LinearLayout namen = new LinearLayout(activity);
        namen.setOrientation(LinearLayout.VERTICAL);
        TextView oben = new TextView(activity);
        oben.setTag("titel");
        oben.setText("Wiedergabe");
        oben.setTextColor(SCHRIFT);
        oben.setTextSize(15);
        oben.setTypeface(Typeface.DEFAULT_BOLD);
        oben.setSingleLine(true);
        oben.setEllipsize(android.text.TextUtils.TruncateAt.END);
        namen.addView(oben);
        TextView unten = new TextView(activity);
        unten.setTag("quelle");
        unten.setTextColor(SCHRIFT_STILL);
        unten.setTextSize(12);
        unten.setSingleLine(true);
        unten.setEllipsize(android.text.TextUtils.TruncateAt.END);
        unten.setVisibility(View.GONE);
        namen.addView(unten);
        LinearLayout.LayoutParams namenLage = new LinearLayout.LayoutParams(0, -2, 1f);
        reihe.addView(namen, namenLage);

        reihe.addView(knopf("Schließen", umgebung::schliessen));
        return reihe;
    }

    private LinearLayout leisteBauen() {
        LinearLayout spalte = new LinearLayout(activity);
        spalte.setOrientation(LinearLayout.VERTICAL);
        spalte.setPadding(dp(18), dp(24), dp(18), dp(12));
        spalte.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { 0x00000000, 0xD1000000 }));

        LinearLayout oben = new LinearLayout(activity);
        oben.setOrientation(LinearLayout.HORIZONTAL);
        oben.setGravity(Gravity.CENTER_VERTICAL);
        TextView stelle = zeit("0:00");
        stelle.setTag("stelle");
        oben.addView(stelle);
        SeekBar bar = reglerBauen();
        bar.setTag("regler");
        LinearLayout.LayoutParams barLage = new LinearLayout.LayoutParams(0, -2, 1f);
        barLage.leftMargin = dp(12);
        barLage.rightMargin = dp(12);
        oben.addView(bar, barLage);
        TextView dauer = zeit("0:00");
        dauer.setTag("dauer");
        oben.addView(dauer);
        spalte.addView(oben, new LinearLayout.LayoutParams(-1, -2));

        // Die zweite Zeile bricht um, statt zu schieben.
        //
        // Vorher lag sie in einem HorizontalScrollView: auf einem Telefon
        // standen damit die Haelfte der Knoepfe ausserhalb des Bildes, und wer
        // "Qualitaet" wollte, musste erst wischen. Eine Bedienleiste, deren
        // Inhalt man suchen muss, ist keine. Jetzt legt {@link Fliessreihe}
        // um, was nicht mehr in die Zeile passt - am Rechner (breit) ist das
        // eine Zeile, am Telefon sind es zwei oder drei, und zu sehen ist
        // immer alles.
        Fliessreihe knoepfe = new Fliessreihe(activity, dp(2), dp(2));
        LinearLayout.LayoutParams reiheLage = new LinearLayout.LayoutParams(-1, -2);
        reiheLage.topMargin = dp(4);
        spalte.addView(knoepfe, reiheLage);

        // Die Reihenfolge ist die des Rechners (spieler.html), Stueck fuer
        // Stueck: spielen, zurueck, vor, Ton, Lautstaerke, Intro | Folgen,
        // Fassung, Hoster, Untertitel, Qualitaet | Autoplay.
        //
        // Nicht "⏸": Android zeichnet dieses Zeichen als *farbiges Emoji*, und
        // dann sitzt ein orangefarbener Kasten zwischen lauter weisser Schrift.
        // "❚❚" ist ein gewoehnliches Textzeichen - dasselbe, das die
        // Teilnehmerleiste am Rechner fuer "haelt an" benutzt.
        TextView los = knopf("▶", this::spielenUmschalten);
        los.setTag("spielen");
        knoepfe.addView(los);
        knoepfe.addView(knopf("−10 s", () -> springen(-10)));
        knoepfe.addView(knopf("+10 s", () -> springen(10)));
        // Knopf und Regler gehören zusammen und wandern zusammen: getrennt
        // umgebrochen stand der Regler allein am Zeilenanfang und sah aus wie
        // ein zweiter Fortschrittsbalken.
        LinearLayout tonGruppe = new LinearLayout(activity);
        tonGruppe.setOrientation(LinearLayout.HORIZONTAL);
        tonGruppe.setGravity(Gravity.CENTER_VERTICAL);
        ImageView klang = tonKnopf();
        klang.setTag("ton");
        tonGruppe.addView(klang);
        SeekBar lautstaerke = lautstaerkeBauen();
        lautstaerke.setTag("lautstaerke");
        tonGruppe.addView(lautstaerke);
        knoepfe.addView(tonGruppe);
        TextView marke = knopf("Intro überspringen", this::introSpringen, true);
        marke.setTag("intro");
        marke.setVisibility(View.GONE);
        knoepfe.addView(marke);

        knoepfe.addView(trenner());
        knoepfe.addView(knopf("Folgen", umgebung::folgen));
        knoepfe.addView(knopf("Fassung", umgebung::fassungen));
        knoepfe.addView(knopf("Hoster", umgebung::hoster));
        knoepfe.addView(knopf("Untertitel", () -> spuren(C.TRACK_TYPE_TEXT, "Untertitel")));
        knoepfe.addView(knopf("Qualität", () -> spuren(C.TRACK_TYPE_VIDEO, "Bildqualität")));
        knoepfe.addView(trenner());
        TextView auto = knopf("Autoplay an", this::autoplayUmschalten);
        auto.setTag("auto");
        knoepfe.addView(auto);
        return spalte;
    }

    /**
     * Der Fortschrittsbalken in drei Zonen.
     *
     * <p>Genau wie am Rechner: der Weg hinter dem Knauf in der Akzentfarbe, der
     * geladene Puffer heller als die Spur, der Rest die Spur. Ein Balken, der
     * durchgehend gleich hell ist, sagt weder, wie weit man ist, noch wieviel
     * schon da ist.
     */
    private LayerDrawable balkenSchichten() {
        LayerDrawable schichten = new LayerDrawable(new Drawable[] {
            balkenStueck(SPUR),
            new ClipDrawable(balkenStueck(SPUR_GELADEN), Gravity.START, ClipDrawable.HORIZONTAL),
            new ClipDrawable(balkenStueck(Theme.PRIMARY), Gravity.START, ClipDrawable.HORIZONTAL)
        });
        schichten.setId(0, android.R.id.background);
        schichten.setId(1, android.R.id.secondaryProgress);
        schichten.setId(2, android.R.id.progress);
        return schichten;
    }

    private ShapeDrawable knaufBauen() {
        ShapeDrawable knauf = new ShapeDrawable(new OvalShape());
        knauf.setIntrinsicWidth(dp(14));
        knauf.setIntrinsicHeight(dp(14));
        knauf.getPaint().setColor(Theme.PRIMARY);
        return knauf;
    }

    private SeekBar reglerBauen() {
        SeekBar bar = new SeekBar(activity);
        bar.setMax(1000);
        bar.setProgressDrawable(balkenSchichten());
        bar.setThumb(knaufBauen());
        bar.setSplitTrack(false);
        bar.setPadding(dp(7), dp(14), dp(7), dp(14));
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar wo, int wert, boolean vonHand) {
                if (!vonHand || player == null) return;
                stelleText.setText(uhr(wert / 1000.0 * dauer()));
            }
            @Override public void onStartTrackingTouch(SeekBar wo) {
                reglerGefasst = true;
                regung();
            }
            @Override public void onStopTrackingTouch(SeekBar wo) {
                reglerGefasst = false;
                if (player == null || dauer() <= 0) return;
                double ziel = wo.getProgress() / 1000.0 * dauer();
                erwartetSeek = ziel;
                erwartetBis = SystemClock.uptimeMillis() + 2000;
                player.seekTo(Math.round(ziel * 1000));
                liveMelden("seek");
                regung();
            }
        });
        return bar;
    }

    /**
     * Der Lautstaerkeregler, wie am Rechner neben dem Tonknopf.
     *
     * <p>Schmal gehalten: er sitzt in einer Zeile mit Woertern, und am Telefon
     * stellt die Lautstaerke meistens die Wippe an der Seite. Wer ihn trotzdem
     * sucht, findet ihn da, wo er drueben auch steht.
     */
    private SeekBar lautstaerkeBauen() {
        SeekBar bar = new SeekBar(activity);
        bar.setMax(100);
        bar.setProgress(100);
        bar.setProgressDrawable(balkenSchichten());
        bar.setThumb(knaufBauen());
        bar.setSplitTrack(false);
        bar.setPadding(dp(7), dp(14), dp(7), dp(14));
        bar.setLayoutParams(new LinearLayout.LayoutParams(dp(72), ViewGroup.LayoutParams.WRAP_CONTENT));
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar wo, int wert, boolean vonHand) {
                if (!vonHand || player == null) return;
                player.setVolume(wert / 100f);
                tonZeichnen(wert > 0);
            }
            @Override public void onStartTrackingTouch(SeekBar wo) { regung(); }
            @Override public void onStopTrackingTouch(SeekBar wo) { regung(); }
        });
        return bar;
    }

    private FrameLayout blendeBauen() {
        FrameLayout rahmen = new FrameLayout(activity);
        rahmen.setBackgroundColor(BLENDE);
        rahmen.setVisibility(View.GONE);
        // Sie faengt die Beruehrung ab: was darunter liegt, ist gerade nicht gemeint.
        rahmen.setClickable(true);
        rahmen.setFocusable(true);

        LinearLayout spalte = new LinearLayout(activity);
        spalte.setOrientation(LinearLayout.VERTICAL);
        spalte.setPadding(dp(14), dp(14), dp(14), dp(18));
        rahmen.addView(spalte, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout kopfzeile = new LinearLayout(activity);
        kopfzeile.setOrientation(LinearLayout.HORIZONTAL);
        kopfzeile.setGravity(Gravity.CENTER_VERTICAL);
        TextView name = new TextView(activity);
        name.setTag("titel");
        name.setTextColor(SCHRIFT);
        name.setTextSize(15);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        kopfzeile.addView(name, new LinearLayout.LayoutParams(0, -2, 1f));
        kopfzeile.addView(knopf("✕", this::blendeZu));
        spalte.addView(kopfzeile, new LinearLayout.LayoutParams(-1, -2));

        ScrollView schiene = new ScrollView(activity);
        schiene.setVerticalScrollBarEnabled(false);
        LinearLayout liste = new LinearLayout(activity);
        liste.setTag("liste");
        liste.setOrientation(LinearLayout.VERTICAL);
        schiene.addView(liste);
        LinearLayout.LayoutParams listeLage = new LinearLayout.LayoutParams(-1, 0, 1f);
        listeLage.topMargin = dp(10);
        spalte.addView(schiene, listeLage);
        return rahmen;
    }

    /* ------------------------------------------------------- Bausteine der Leiste */

    private int dp(int wert) {
        return Math.round(wert * activity.getResources().getDisplayMetrics().density);
    }

    private GradientDrawable flaeche(int farbe, int radius, int rahmen, int strichDp) {
        GradientDrawable form = new GradientDrawable();
        form.setColor(farbe);
        form.setCornerRadius(dp(radius));
        if (strichDp > 0) form.setStroke(dp(strichDp), rahmen);
        return form;
    }

    private GradientDrawable balkenStueck(int farbe) {
        GradientDrawable form = new GradientDrawable();
        form.setColor(farbe);
        form.setCornerRadius(dp(3));
        return form;
    }

    private TextView zeit(String text) {
        TextView view = new TextView(activity);
        view.setText(text);
        view.setTextColor(SCHRIFT_LEISE);
        view.setTextSize(13);
        view.setTypeface(Typeface.MONOSPACE);
        return view;
    }

    private View trenner() {
        View strich = new View(activity);
        // Daran erkennt die Fliessreihe ihn: ein Strich am Zeilenanfang trennt
        // nichts und sieht aus wie ein Fehler.
        strich.setTag("trenner");
        strich.setBackgroundColor(0x33FFFFFF);
        LinearLayout.LayoutParams lage = new LinearLayout.LayoutParams(dp(1), dp(22));
        lage.leftMargin = dp(6);
        lage.rightMargin = dp(6);
        strich.setLayoutParams(lage);
        return strich;
    }

    /**
     * Ein Knopf der Leiste.
     *
     * <p>Ohne Flaeche, bis er gemeint ist - am Rechner beim Ueberfahren, hier
     * unter dem Finger und unter dem Fokus. Der Fokuszustand ist am Fernseher
     * das Einzige, woran man sieht, wohin das Steuerkreuz zeigt: er bekommt
     * deshalb die volle Akzentflaeche und nicht nur einen Hauch davon.
     */
    private TextView knopf(String text, Runnable aktion) {
        return knopf(text, aktion, false);
    }

    /**
     * Der Tonknopf - ein gezeichneter Lautsprecher.
     *
     * <p>Kein Zeichen aus der Schrift: "\ud83d\udd0a" ist ein Emoji, und Android
     * zeichnet Emoji in Farbe. Zwischen lauter weissen Woertern sass da ein
     * bunter Fleck. Ein eigener Strich ist zwei Dutzend Zeilen und dafuer
     * genau so hell wie der Rest der Leiste.
     */
    private ImageView tonKnopf() {
        ImageView bild = new ImageView(activity);
        bild.setImageDrawable(new Lautsprecher(dp(19), true));
        bild.setScaleType(ImageView.ScaleType.CENTER);
        bild.setMinimumHeight(dp(48));
        bild.setMinimumWidth(dp(44));
        bild.setPadding(dp(9), dp(10), dp(9), dp(10));
        LinearLayout.LayoutParams lage = new LinearLayout.LayoutParams(-2, -2);
        lage.rightMargin = dp(2);
        bild.setLayoutParams(lage);
        anfassbar(bild, 10, this::tonUmschalten, false);
        return bild;
    }

    /** Der betonte Knopf traegt die Akzentflaeche schon in Ruhe - wie {@code .betont} drueben. */
    private TextView knopf(String text, Runnable aktion, boolean betont) {
        TextView knopf = new TextView(activity);
        knopf.setText(text);
        knopf.setTextColor(SCHRIFT);
        // Ein Haar kleiner als die Kopfzeile: damit passt die ganze Reihe quer
        // in eine Zeile, und darum geht es hier - eine zweite Zeile fuer einen
        // einzigen Knopf sieht aus wie ein Versehen.
        knopf.setTextSize(13);
        knopf.setGravity(Gravity.CENTER);
        knopf.setMinHeight(dp(48));
        knopf.setMinWidth(dp(48));
        // Eng genug, dass die ganze Reihe quer in eine Zeile passt, und weit
        // genug fuer einen Daumen: die Hoehe traegt das Ziel, nicht die Breite.
        knopf.setPadding(dp(9), dp(10), dp(9), dp(10));
        if (betont) knopf.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams lage = new LinearLayout.LayoutParams(-2, -2);
        lage.rightMargin = dp(2);
        knopf.setLayoutParams(lage);
        anfassbar(knopf, 10, aktion, betont);
        return knopf;
    }

    private void anfassbar(View view, int radius, Runnable aktion) {
        anfassbar(view, radius, aktion, false);
    }

    /**
     * Druck, Fokus und Klick an einer Stelle.
     *
     * <p>Ein Knopf, der beim Antippen nichts tut, bis die Folge wechselt, fuehlt
     * sich kaputt an - deshalb geht hier immer sofort etwas: die Flaeche kommt,
     * und {@link Bewegung#druck} gibt nach. Ueber Bewegung und nicht mit fester
     * Zahl, damit "Animationen entfernen" auch hier gilt.
     *
     * <p>Wer schon eine Flaeche mitbringt (die Karte zur naechsten Folge),
     * behaelt sie: sie ist dann der Ruhezustand, in den der Fokus zurueckfaellt.
     */
    private void anfassbar(View view, int radius, Runnable aktion, boolean betont) {
        final GradientDrawable wach = flaeche(KNOPF_DRUCK, radius, 0, 0);
        final GradientDrawable fokus = flaeche(Theme.PRIMARY, radius, 0, 0);
        final Drawable grund = view.getBackground() != null ? view.getBackground()
            : betont ? flaeche(Theme.PRIMARY, radius, 0, 0) : flaeche(Color.TRANSPARENT, radius, 0, 0);
        view.setBackground(grund);
        view.setFocusable(true);
        view.setFocusableInTouchMode(false);
        view.setOnFocusChangeListener((v, hat) -> {
            v.setBackground(hat ? fokus : grund);
            Bewegung.fokus(v, hat, 1.04f, hat ? 10f : 0f);
            if (hat) regung();
        });
        view.setOnTouchListener((v, ereignis) -> {
            int was = ereignis.getActionMasked();
            if (was == MotionEvent.ACTION_DOWN) {
                v.setBackground(v.isFocused() ? fokus : wach);
                Bewegung.druck(v, true, 0.97f);
            } else if (was == MotionEvent.ACTION_UP || was == MotionEvent.ACTION_CANCEL) {
                v.setBackground(v.isFocused() ? fokus : grund);
                Bewegung.druck(v, false, 0.97f);
            }
            return false;
        });
        view.setOnClickListener(v -> {
            regung();
            aktion.run();
        });
    }

    /* --------------------------------------------------- Schichten und Anzeige */

    /** Es ist etwas geschehen: Bedienung zeigen und die Ruhe neu stellen. */
    private void regung() {
        schichtenSetzen(true);
        handler.removeCallbacks(verbergen);
        handler.postDelayed(verbergen, RUHE_MS);
    }

    private final Runnable verbergen = this::vielleichtVerbergen;

    private void vielleichtVerbergen() {
        // Nicht wegnehmen, solange jemand etwas davon braucht: ein gefasster
        // Regler, eine offene Blende, ein stehender Kasten - und nichts
        // wegnehmen, solange das Bild ohnehin steht.
        if (geschlossen || reglerGefasst || blende.getVisibility() == View.VISIBLE) return;
        if (kasten.getVisibility() == View.VISIBLE) return;
        if (player == null || !player.isPlaying()) return;
        schichtenSetzen(false);
    }

    private void schichtenSetzen(boolean an) {
        if (schichtenAn == an) return;
        schichtenAn = an;
        umgebung.bedienung(an);
        for (View schicht : new View[] { kopf, leiste, weiterKarte }) {
            if (schicht == weiterKarte && !(hatNaechste && zaehlerEnde == 0 && amEnde())) continue;
            schicht.setVisibility(View.VISIBLE);
            long dauer = Bewegung.dauer(activity, Bewegung.MITTEL);
            if (dauer <= 0) {
                schicht.setAlpha(an ? 1f : 0f);
                if (!an) schicht.setVisibility(View.INVISIBLE);
                continue;
            }
            schicht.animate().cancel();
            schicht.animate().alpha(an ? 1f : 0f).setDuration(dauer)
                .setInterpolator(an ? Bewegung.hinein() : Bewegung.hinaus())
                .withEndAction(() -> {
                    if (!schichtenAn) schicht.setVisibility(View.INVISIBLE);
                }).start();
        }
        if (an) return;
        // Ohne das behielte ein Knopf den Fokus hinter einer unsichtbaren
        // Leiste - und der naechste Druck auf OK loeste ihn blind aus.
        ansicht.requestFocus();
    }

    /** Wohin der Live-Streifen der Watchparty gehoert: ganz oben, ueber dem Kopf. */
    FrameLayout streifenPlatz() { return streifenPlatz; }

    void titel(String text) {
        titel.setText(text);
    }

    /** Woher das Bild kommt - dieselbe zweite Zeile wie im Kopf des Rechner-Players. */
    void quelleBenannt(String hoster, String sprache) {
        String text = hoster == null ? "" : hoster.trim();
        if (sprache != null && !sprache.trim().isEmpty()) {
            text = text.isEmpty() ? sprache.trim() : text + " · " + sprache.trim();
        }
        quellenname.setText(text);
        quellenname.setVisibility(text.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /** Eine Ansage in der Mitte - Laden, Fehler, Zaehler. Sie haelt die Bedienung wach. */
    void status(String text) {
        hinweis.setText(text);
        kastenKnoepfe.removeAllViews();
        kastenKnoepfe.setVisibility(View.GONE);
        kasten.setVisibility(View.VISIBLE);
        regung();
    }

    private void kastenKnopf(String text, Runnable aktion) {
        // Der erste Knopf im Kasten ist der gemeinte - er traegt die Akzentflaeche.
        TextView knopf = knopf(text, aktion, kastenKnoepfe.getChildCount() == 0);
        kastenKnoepfe.addView(knopf);
        kastenKnoepfe.setVisibility(View.VISIBLE);
    }

    private void kastenZu() {
        kasten.setVisibility(View.GONE);
        kastenKnoepfe.removeAllViews();
    }

    void naechsteVorhanden(boolean ja) {
        hatNaechste = ja;
        weiterkarteZeigen();
    }

    /**
     * Steht die Karte zur naechsten Folge gerade an?
     *
     * <p>Vier Bedingungen, alle noetig: es gibt eine naechste Folge, die
     * Bedienung ist zu sehen, es laeuft kein Zaehler (der hat seinen eigenen
     * Kasten) - und die Folge ist zu {@link #WEITER_AB_PROZENT} Prozent
     * vorbei.
     */
    private void weiterkarteZeigen() {
        boolean sichtbar = hatNaechste && schichtenAn && zaehlerEnde == 0 && amEnde();
        weiterKarte.setVisibility(sichtbar ? View.VISIBLE : View.GONE);
    }

    /** Ist die Folge weit genug, dass die naechste zur Sprache kommt? */
    private boolean amEnde() {
        double dauer = dauer();
        return dauer > 0 && position() >= dauer * WEITER_AB_PROZENT / 100.0;
    }

    /** Der Titel der naechsten Folge - er steht auf der Karte und im Zaehler. */
    void naechsterTitel(String text) {
        naechsterTitel = text == null ? "" : text;
        weiterTitel.setText(naechsterTitel);
        weiterTitel.setVisibility(naechsterTitel.isEmpty() ? View.GONE : View.VISIBLE);
    }

    /* ------------------------------------------------------------ Die Bedienung */

    private void spielenUmschalten() {
        if (player == null) return;
        boolean laeuft = player.getPlayWhenReady();
        player.setPlayWhenReady(!laeuft);
        spielenZeichnen();
    }

    private void spielenZeichnen() {
        boolean laeuft = player != null && player.getPlayWhenReady();
        spielen.setText(laeuft ? "❚❚" : "▶");
    }

    private void springen(int sekunden) {
        if (player == null) return;
        double ziel = Math.max(0, position() + sekunden);
        if (dauer() > 0) ziel = Math.min(ziel, dauer() - 0.5);
        erwartetSeek = ziel;
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        player.seekTo(Math.round(ziel * 1000));
        liveMelden("seek");
    }

    private void tonUmschalten() {
        if (player == null) return;
        boolean stumm = player.getVolume() <= 0.01f;
        player.setVolume(stumm ? 1f : 0f);
        tonZeichnen(stumm);
    }

    private void tonZeichnen(boolean an) {
        ton.setImageDrawable(new Lautsprecher(dp(19), an));
        ton.setContentDescription(an ? "Ton an" : "Ton aus");
    }

    private void introSpringen() {
        if (player == null || introZiel <= position()) return;
        erwartetSeek = introZiel;
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        player.seekTo(Math.round(introZiel * 1000));
        liveMelden("seek");
    }

    private void autoplayText() {
        automatisch.setText(Folgen.autoplayAn(activity) ? "Autoplay an" : "Autoplay aus");
        automatisch.setAlpha(Folgen.autoplayAn(activity) ? 1f : 0.5f);
    }

    private void autoplayUmschalten() {
        Folgen.setzeAutoplayAn(activity, !Folgen.autoplayAn(activity));
        endeAbgesagt = !Folgen.autoplayAn(activity);
        zaehlerEnde = 0;
        autoplayText();
        kastenZu();
    }

    /* ---------------------------------------------------------------- Die Blende */

    /**
     * Eine Liste von rechts - Quellen, Folgen, Spuren.
     *
     * <p>Sie ersetzt die Systemdialoge, die vorher an drei Stellen aufgingen:
     * die haben ihre eigene Gestaltung, ihre eigene Schrift und am Fernseher
     * ihre eigene Bedienung. Eine Liste, die zur App gehoert, gehoert in die App.
     *
     * @param laufend Zeile, die gerade gilt - sie bekommt die Akzentflaeche. -1 fuer keine.
     */
    void blende(String name, List<String> eintraege, List<Runnable> aktionen, int laufend) {
        if (geschlossen) return;
        blendeTitel.setText(name);
        blendeListe.removeAllViews();
        for (int i = 0; i < eintraege.size(); i++) {
            final int index = i;
            TextView zeile = new TextView(activity);
            zeile.setText(eintraege.get(i));
            zeile.setTextColor(SCHRIFT);
            zeile.setTextSize(14);
            zeile.setMinHeight(dp(48));
            zeile.setGravity(Gravity.CENTER_VERTICAL);
            zeile.setPadding(dp(12), dp(10), dp(12), dp(10));
            LinearLayout.LayoutParams lage = new LinearLayout.LayoutParams(-1, -2);
            lage.bottomMargin = dp(4);
            zeile.setLayoutParams(lage);
            if (i == laufend) {
                zeile.setBackground(flaeche(Theme.PRIMARY_MUTED, 10, 0, 0));
                zeile.setTypeface(Typeface.DEFAULT_BOLD);
            } else {
                zeile.setBackground(flaeche(ZEILE, 10, 0, 0));
            }
            final GradientDrawable grund = (GradientDrawable) zeile.getBackground();
            final GradientDrawable fokus = flaeche(Theme.PRIMARY, 10, 0, 0);
            final GradientDrawable druck = flaeche(ZEILE_DRUCK, 10, 0, 0);
            zeile.setFocusable(true);
            zeile.setOnFocusChangeListener((v, hat) -> v.setBackground(hat ? fokus : grund));
            zeile.setOnTouchListener((v, ereignis) -> {
                int was = ereignis.getActionMasked();
                if (was == MotionEvent.ACTION_DOWN) v.setBackground(druck);
                else if (was == MotionEvent.ACTION_UP || was == MotionEvent.ACTION_CANCEL) {
                    v.setBackground(v.isFocused() ? fokus : grund);
                }
                return false;
            });
            zeile.setOnClickListener(v -> {
                blendeZu();
                if (index < aktionen.size()) aktionen.get(index).run();
            });
            blendeListe.addView(zeile);
        }
        blende.getLayoutParams().width = Math.min(dp(420),
            Math.round(activity.getResources().getDisplayMetrics().widthPixels * 0.92f));
        blende.setVisibility(View.VISIBLE);
        blende.requestLayout();
        regung();
        // Der erste Eintrag ist der wahrscheinlichste - am Fernseher steht das
        // Steuerkreuz damit sofort auf etwas Sinnvollem.
        if (blendeListe.getChildCount() > 0) blendeListe.getChildAt(0).requestFocus();
        Bewegung.einblenden(blende);
    }

    private void blendeZu() {
        if (blende.getVisibility() != View.VISIBLE) return;
        blende.setVisibility(View.GONE);
        blendeListe.removeAllViews();
        regung();
    }

    boolean blendeOffen() {
        return blende.getVisibility() == View.VISIBLE;
    }

    /* -------------------------------------------------------------- Die Quelle */

    void quelle(String url, String typ, Map<String, String> kopfzeilen, double start) {
        freigeben();
        if (geschlossen) return;
        quelleLaedt = true;
        OkHttpDataSource.Factory netz = new OkHttpDataSource.Factory(CookieNetz.erstellen())
            .setDefaultRequestProperties(kopfzeilen);
        player = new ExoPlayer.Builder(activity)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(netz))
            .setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(30000).build();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        bild.setPlayer(player);
        ExoPlayer lauf = player;
        lauf.addListener(new Player.Listener() {
            private boolean startGeprueft;
            @Override public void onPlaybackStateChanged(int state) {
                if (geschlossen || player != lauf) return;
                puffer.setVisibility(state == Player.STATE_BUFFERING ? View.VISIBLE : View.GONE);
                if (state == Player.STATE_READY) {
                    quelleLaedt = false;
                    kastenZu();
                    if (!startGeprueft && lauf.getDuration() > 0 && start > 5 && lauf.getCurrentPosition() >= lauf.getDuration() - 20000) {
                        lauf.seekTo(0);
                    }
                    startGeprueft = true;
                    if (!bereitGemeldet) { bereitGemeldet = true; umgebung.bereit(); }
                    befehlPruefen();
                }
                if (state == Player.STATE_ENDED) speichern();
            }
            @Override public void onPlayerError(PlaybackException fehler) {
                if (player != lauf) return;
                puffer.setVisibility(View.GONE);
                status("Diese Quelle spielt nicht.\n" + fehler.getErrorCodeName());
                kastenKnopf("Anderen Hoster wählen", umgebung::hoster);
                kastenKnopf("Schließen", umgebung::schliessen);
                regung();
            }
            @Override public void onIsPlayingChanged(boolean playing) {
                ansicht.setKeepScreenOn(playing);
                zuletzt = SystemClock.elapsedRealtime();
                letztePosition = lauf.getCurrentPosition() / 1000.0;
                spielenZeichnen();
                // Steht das Bild, bleibt die Bedienung stehen: es gibt gerade
                // nichts zu sehen, was sie verdecken koennte.
                if (!playing) regung();
            }
            @Override public void onPlayWhenReadyChanged(boolean playing, int reason) {
                spielenZeichnen();
                if (SystemClock.uptimeMillis() < erwartetBis && erwartetPlay != null && erwartetPlay == playing) {
                    erwartetPlay = null;
                    return;
                }
                if (aktiv && bereitGemeldet && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
                    liveMelden(playing ? "play" : "pause");
                }
            }
            @Override public void onPositionDiscontinuity(Player.PositionInfo alt, Player.PositionInfo neu, int reason) {
                if (SystemClock.uptimeMillis() < erwartetBis && Math.abs(neu.positionMs / 1000.0 - erwartetSeek) < 2) {
                    erwartetSeek = -1;
                    return;
                }
                if (aktiv && bereitGemeldet && reason == Player.DISCONTINUITY_REASON_SEEK) {
                    liveMelden("seek");
                    if (sprungVon < 0) sprungVon = alt.positionMs / 1000.0;
                    sprungNach = neu.positionMs / 1000.0;
                    handler.removeCallbacks(sprungMelden);
                    handler.postDelayed(sprungMelden, 800);
                }
            }
        });
        MediaItem.Builder item = new MediaItem.Builder().setUri(Uri.parse(url));
        if ("hls".equals(typ)) item.setMimeType(MimeTypes.APPLICATION_M3U8);
        lauf.setMediaItem(item.build(), Math.max(0, Math.round(start * 1000)));
        lauf.prepare();
        lauf.setPlayWhenReady(aktiv);
        endeAbgesagt = false;
        zaehlerEnde = 0;
        zuletzt = SystemClock.elapsedRealtime();
        autoplayText();
        spielenZeichnen();
        regung();
    }

    double position() { return player == null ? letztePosition : player.getCurrentPosition() / 1000.0; }

    private double dauer() {
        long wert = player == null ? 0 : player.getDuration();
        return wert > 0 ? wert / 1000.0 : 0;
    }

    void wechselPause() {
        quelleLaedt = true;
        if (player != null) { erwartetPlay = false; erwartetBis = SystemClock.uptimeMillis() + 2000; player.pause(); }
    }

    void pause() {
        aktiv = false;
        zaehlerEnde = 0;
        endeAbgesagt = true;
        if (player != null) player.pause();
        speichern();
    }

    void vordergrund() { aktiv = true; befehlPruefen(); }

    /* ------------------------------------------------------------------ Der Takt */

    /** Der Anzeigetakt: Balken und Zeiten, nur solange man sie sieht. */
    private final Runnable balken = new Runnable() {
        @Override public void run() {
            if (geschlossen) return;
            if (schichtenAn && player != null) {
                double dauer = dauer();
                double stelle = position();
                if (!reglerGefasst) {
                    regler.setProgress(dauer > 0 ? (int) Math.round(stelle / dauer * 1000) : 0);
                    stelleText.setText(uhr(stelle));
                }
                regler.setSecondaryProgress(dauer > 0
                    ? (int) Math.round(player.getBufferedPosition() / 1000.0 / dauer * 1000) : 0);
                dauerText.setText(uhr(dauer));
                // Die Schwelle faellt mitten in der Folge - also hier mitfuehren
                // und nicht nur beim Zeichnen der Schichten.
                weiterkarteZeigen();
            }
            handler.postDelayed(this, 250);
        }
    };

    private static String uhr(double sekunden) {
        if (!(sekunden > 0)) return "0:00";
        long ganz = Math.round(sekunden);
        long stunden = ganz / 3600;
        long minuten = (ganz % 3600) / 60;
        long rest = ganz % 60;
        return stunden > 0
            ? String.format(Locale.GERMANY, "%d:%02d:%02d", stunden, minuten, rest)
            : String.format(Locale.GERMANY, "%d:%02d", minuten, rest);
    }

    private final Runnable takt = new Runnable() {
        @Override public void run() {
            if (geschlossen) return;
            long jetzt = SystemClock.elapsedRealtime();
            if (player != null) {
                double position = position();
                double delta = position - letztePosition;
                if (player.isPlaying() && delta > 0 && delta < 2.5) {
                    gespielt += Math.min(delta, Math.max(0, (jetzt - zuletzt) / 1000.0));
                }
                letztePosition = position;
                zuletzt = jetzt;
                if (jetzt - letztesSpeichern >= 5000) speichern();
                if (aktiv) liveMelden("");
                introPruefen();
                befehlPruefen();
                if (aktiv && player.getPlaybackState() == Player.STATE_ENDED && hatNaechste
                    && Folgen.autoplayAn(activity) && !endeAbgesagt && umgebung.darfAutoplay()) {
                    if (zaehlerEnde == 0) {
                        zaehlerEnde = jetzt + Folgen.ZAEHLER_SEKUNDEN * 1000;
                        weiterKarte.setVisibility(View.GONE);
                        status("");
                        kastenKnopf("Jetzt", () -> {
                            endeAbgesagt = true;
                            zaehlerEnde = 0;
                            umgebung.naechste();
                        });
                        kastenKnopf("Hier bleiben", () -> {
                            endeAbgesagt = true;
                            zaehlerEnde = 0;
                            kastenZu();
                            naechsteVorhanden(hatNaechste);
                        });
                        if (kastenKnoepfe.getChildCount() > 0) kastenKnoepfe.getChildAt(0).requestFocus();
                    }
                    long rest = Math.max(0, (zaehlerEnde - jetzt + 999) / 1000);
                    hinweis.setText(naechsterTitel.isEmpty()
                        ? "Nächste Folge in " + rest + " s"
                        : "Nächste Folge in " + rest + " s\n" + naechsterTitel);
                    if (jetzt >= zaehlerEnde) {
                        endeAbgesagt = true;
                        umgebung.naechste();
                    }
                }
            }
            handler.postDelayed(this, 1000);
        }
    };

    void speichern() {
        if (player == null || player.getDuration() <= 0) return;
        letztesSpeichern = SystemClock.elapsedRealtime();
        try {
            umgebung.stand(new JSONObject().put("currentTime", position())
                .put("duration", player.getDuration() / 1000.0).put("playedSeconds", gespielt)
                .put("ended", player.getPlaybackState() == Player.STATE_ENDED));
        } catch (org.json.JSONException ignoriert) { }
    }

    private void liveMelden(String aktion) {
        if (player == null || geschlossen || !bereitGemeldet) return;
        try {
            umgebung.live(liveStand(), aktion);
        } catch (org.json.JSONException ignoriert) { }
    }

    JSONObject liveStand() throws org.json.JSONException {
        return new JSONObject().put("position", position())
            .put("duration", player == null ? 0 : Math.max(0, player.getDuration()) / 1000.0)
            .put("paused", player == null || !player.getPlayWhenReady())
            .put("puffert", player == null || player.getPlaybackState() != Player.STATE_READY);
    }

    /* ------------------------------------------------------------- Die Watchparty */

    void steuern(JSONObject urteil, Runnable bereit) {
        if (geschlossen) return;
        String tun = urteil.optString("tun");
        if ("drift".equals(tun) || "nichts".equals(tun)) return;
        wartenderBefehl = new Befehl(urteil, bereit);
        befehlPruefen();
    }

    boolean wartetAufBefehl() { return wartenderBefehl != null; }

    private void befehlPruefen() {
        Befehl befehl = wartenderBefehl;
        if (geschlossen || !aktiv || quelleLaedt || player == null || befehl == null
            || player.getPlaybackState() != Player.STATE_READY) return;
        if (!befehl.angewendet) {
            if (befehl.rechnet) return;
            befehl.rechnet = true;
            ExoPlayer lauf = player;
            kern.rufe("direkt-android.befehlJetzt", Kern.args(befehl.urteil), (wert, fehler) -> {
                if (wartenderBefehl != befehl || player != lauf || geschlossen) return;
                befehl.rechnet = false;
                if (!aktiv || quelleLaedt || player.getPlaybackState() != Player.STATE_READY) return;
                try { befehl.urteil = new JSONObject(wert); } catch (Exception e) { return; }
                befehl.ziel = Math.max(0, befehl.urteil.optDouble("position", position()));
                if (player.getDuration() > 0) befehl.ziel = Math.min(befehl.ziel, Math.max(0, player.getDuration() / 1000.0 - 0.1));
                befehl.angewendet = true;
                erwartetBis = SystemClock.uptimeMillis() + 2000;
                erwartetPlay = false;
                player.pause();
                if (!befehl.urteil.optBoolean("nichtSpringen")) {
                    erwartetSeek = befehl.ziel;
                    player.seekTo(Math.round(befehl.ziel * 1000));
                }
                handler.postDelayed(this::befehlPruefen, 100);
            });
            return;
        }
        if (!befehl.urteil.optBoolean("nichtSpringen") && Math.abs(position() - befehl.ziel) > 1.5) return;
        JSONObject ereignis = befehl.urteil.optJSONObject("ereignis");
        boolean play = !befehl.urteil.optBoolean("warten") && ereignis != null && ereignis.optBoolean("playing");
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        erwartetPlay = play;
        wartenderBefehl = null;
        player.setPlayWhenReady(play);
        spielenZeichnen();
        if (befehl.bereit != null) befehl.bereit.run();
    }

    private final Runnable sprungMelden = this::sprungAbschliessen;
    private void sprungAbschliessen() {
        if (!geschlossen && sprungVon >= 0) umgebung.sprung(sprungVon, sprungNach);
        sprungVon = -1;
    }

    private void introPruefen() {
        if (player == null || geschlossen) return;
        if (SystemClock.uptimeMillis() - letzteMarkenFrage >= 5000) {
            letzteMarkenFrage = SystemClock.uptimeMillis();
            umgebung.marke(marke -> { if (!geschlossen) introMarke = marke; });
        }
        if (introMarke == null) { intro.setVisibility(View.GONE); return; }
        ExoPlayer lauf = player;
        kern.rufe("direkt-android.intro", Kern.args(introMarke, position()), (wert, fehler) -> {
            if (geschlossen || player != lauf) return;
            try {
                JSONObject stand = new JSONObject(wert);
                introZiel = stand.optDouble("ziel");
                intro.setVisibility(stand.optBoolean("sichtbar") ? View.VISIBLE : View.GONE);
            } catch (Exception ignoriert) { }
        });
    }

    /* ------------------------------------------------------------------- Spuren */

    private void spuren(int typ, String name) {
        if (player == null) return;
        ArrayList<String> namen = new ArrayList<>();
        ArrayList<Runnable> aktionen = new ArrayList<>();
        ArrayList<TrackSelectionOverride> auswahl = new ArrayList<>();
        namen.add(typ == C.TRACK_TYPE_TEXT ? "Aus" : "Automatisch");
        auswahl.add(null);
        int laufend = 0;
        for (Tracks.Group gruppe : player.getCurrentTracks().getGroups()) {
            if (gruppe.getType() != typ) continue;
            for (int i = 0; i < gruppe.length; i++) {
                if (!gruppe.isTrackSupported(i)) continue;
                Format format = gruppe.getTrackFormat(i);
                String text = typ == C.TRACK_TYPE_VIDEO ? format.height + "p"
                    : (format.label != null ? format.label : format.language != null ? format.language : "Spur " + (i + 1));
                if (gruppe.isTrackSelected(i)) laufend = namen.size();
                namen.add(text);
                auswahl.add(new TrackSelectionOverride(gruppe.getMediaTrackGroup(), i));
            }
        }
        final ExoPlayer lauf = player;
        for (int i = 0; i < namen.size(); i++) {
            final int index = i;
            aktionen.add(() -> {
                if (player != lauf) return;
                androidx.media3.common.TrackSelectionParameters.Builder params = lauf.getTrackSelectionParameters()
                    .buildUpon().clearOverridesOfType(typ).setTrackTypeDisabled(typ, typ == C.TRACK_TYPE_TEXT && index == 0);
                if (auswahl.get(index) != null) params.setOverrideForType(auswahl.get(index));
                lauf.setTrackSelectionParameters(params.build());
            });
        }
        blende(name, namen, aktionen, laufend);
    }

    /* -------------------------------------------------------------- Die Tasten */

    /**
     * Die Fernbedienung.
     *
     * <p>Ohne den mitgelieferten Bedienteil gibt es niemanden mehr, der die
     * Medientasten deutet - das steht deshalb hier. Und: solange die Bedienung
     * weg ist, weckt die erste Taste nur sie. Sonst spraenge ein Druck auf OK
     * blind auf den Knopf, der zufaellig zuletzt den Fokus hatte.
     */
    boolean taste(KeyEvent event) {
        int code = event.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) return false;
        boolean runter = event.getAction() == KeyEvent.ACTION_DOWN;

        if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_MEDIA_PLAY
            || code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (runter) { spielenUmschalten(); regung(); }
            return true;
        }
        if (code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) {
            if (runter) { springen(30); regung(); }
            return true;
        }
        if (code == KeyEvent.KEYCODE_MEDIA_REWIND) {
            if (runter) { springen(-10); regung(); }
            return true;
        }
        if (code == KeyEvent.KEYCODE_MEDIA_NEXT) {
            if (runter && hatNaechste) umgebung.naechste();
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU) {
            if (runter) {
                regung();
                leiste.requestFocus();
            }
            return true;
        }
        if (blendeOffen()) return false;
        if (!schichtenAn) {
            // Erst wecken. Links und rechts springen dabei trotzdem - das ist
            // die Geste, die man auf einer Fernbedienung erwartet.
            if (runter) {
                if (code == KeyEvent.KEYCODE_DPAD_LEFT) springen(-10);
                else if (code == KeyEvent.KEYCODE_DPAD_RIGHT) springen(30);
                else if (code == KeyEvent.KEYCODE_DPAD_CENTER || code == KeyEvent.KEYCODE_ENTER) {
                    spielenUmschalten();
                }
                regung();
                if (code == KeyEvent.KEYCODE_DPAD_UP || code == KeyEvent.KEYCODE_DPAD_DOWN) {
                    leiste.requestFocus();
                }
            }
            return true;
        }
        if (runter) handler.removeCallbacks(verbergen);
        if (event.getAction() == KeyEvent.ACTION_UP) regung();
        return false;
    }

    boolean zurueck() {
        if (blendeOffen()) {
            blendeZu();
            return true;
        }
        if (zaehlerEnde > 0 && !endeAbgesagt) {
            endeAbgesagt = true;
            zaehlerEnde = 0;
            kastenZu();
            naechsteVorhanden(hatNaechste);
            return true;
        }
        return false;
    }

    private void freigeben() {
        if (player == null) return;
        handler.removeCallbacks(sprungMelden);
        sprungMelden.run();
        if (wartenderBefehl != null) {
            wartenderBefehl.angewendet = false;
            wartenderBefehl.rechnet = false;
        }
        speichern();
        bild.setPlayer(null);
        ExoPlayer alt = player;
        player = null;
        alt.release();
        bereitGemeldet = false;
        ansicht.setKeepScreenOn(false);
    }

    void schliessen() {
        sprungMelden.run();
        wartenderBefehl = null;
        geschlossen = true;
        handler.removeCallbacksAndMessages(null);
        freigeben();
    }
}
