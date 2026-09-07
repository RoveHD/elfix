package local.elflix.android;

import android.app.Activity;
import android.content.pm.ApplicationInfo;
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
import android.util.Log;
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
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.SeekParameters;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.video.VideoFrameMetadataListener;
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
    private static final String FRAME_LOG = "ELFIXFrame";
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

        /** Die Fassung der Runde uebernehmen - der Host hat sie gestellt. */
        default void fassungWaehlen(String fassung, String hoster) { }

        /** Das Tempo dieses Geraets an die Runde melden. Ohne Runde tut es nichts. */
        default void tempo(double wert) { }

        /**
         * Laeuft hier gerade eine Runde mit?
         *
         * <p>Dann faengt dieser Player nicht allein an: Play meldet die Absicht,
         * und losgefahren wird zu dem Zeitpunkt, den die Runde nennt.
         */
        default boolean inRunde() { return false; }

        /** Gibt dieses Geraet in der laufenden Runde gerade den Takt vor? */
        default boolean istRundenHost() { return false; }

        /**
         * Darf hier ueberhaupt am Tempo gedreht werden?
         *
         * <p>Allein: immer. In einer Runde: nur der Host - zwei Geraete mit
         * verschiedenem Tempo laufen unweigerlich auseinander, und kein
         * Abgleich holt das wieder ein.
         */
        default boolean darfTempo() { return true; }
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
    /** Die Flaeche des Knopfs in der Mitte - dieselbe Tiefe wie drueben (0.58). */
    private static final int MITTE_KNOPF = 0x940A0E16;
    /** Eine Zeile in einer Liste - dieselben sechs Prozent wie drueben. */
    private static final int ZEILE = 0x0FFFFFFF;
    private static final int SPUR = 0x38FFFFFF;
    private static final int SPUR_GELADEN = 0x6BFFFFFF;
    private static final int RAHMEN = 0x47FFFFFF;

    /** Wie lange die Schichten stehenbleiben, wenn nichts geschieht. */
    private static final long RUHE_MS = 5000;

    /** Ab welchem Abstand ein Befehl aus der Runde wirklich springt - siehe befehlPruefen. */
    private static final double SPRUNG_AB_SEKUNDEN = 0.5;

    /**
     * So nah muss die gemeldete Player-Stelle am millisekundengenauen Ziel sitzen.
     *
     * <p>Der gerenderte Bild-PTS hat darunter seine eigene, aus der Bildrate
     * berechnete Toleranz: verschiedene Qualitaetsstufen haben nicht zwingend
     * dasselbe Frame-Raster.
     */
    private static final double SEEK_TOLERANZ_S = 0.001;
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
    private final TextView zehnZurueck;
    private final TextView zehnVor;
    private final ImageView ton;
    private final TextView automatisch;
    /** Der Tempo-Knopf in der Leiste - er traegt die laufende Stufe als Beschriftung. */
    private final TextView tempoText;
    private final TextView intro;

    private final LinearLayout mitte;
    /** Abspielen und Pause in der Mitte - siehe {@link #mitteZeichnen()}. */
    private final TextView mitteSpielen;
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
    /** Die Reiterzeile der Blende - Staffeln, wie am Rechner. Leer bleibt sie weg. */
    private final Fliessreihe blendeReiter;
    /** Der Platz fuer "wird gelesen ..." und "nichts da" unter den Reitern. */
    private final TextView blendeLeer;

    /**
     * Die kurze Ansage.
     *
     * <p>Ein Streifen oben, der von selbst wieder geht. Er ist nicht der Kasten
     * in der Mitte: der beantwortet "warum sehe ich nichts?" und bleibt deshalb
     * stehen, bis die Antwort da ist. Dieser hier sagt nur etwas ("in einer
     * Runde stellt der Host das Tempo") - und was man nur zur Kenntnis nimmt,
     * soll nicht stehenbleiben, bis man es wegdrueckt.
     */
    private final TextView ansage;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private ExoPlayer player;
    /** Feste MPEG-TS-Zeitnull der laufenden HLS-Quelle; null bei MP4. */
    private KanonischesHls hlsZeit;
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
    /** PTS des zuletzt wirklich zur Anzeige freigegebenen Videobilds. */
    private double letzteBildZeit = Double.NaN;
    /** Bildrate der Spur, aus deren Callback {@link #letzteBildZeit} stammt. */
    private double letzteBildRate = Double.NaN;
    /** Zaehlt wirklich freigegebene Bilder; ein genauer Sprung wartet auf ein neues. */
    private long letzteBildFolge;
    /** Verhindert, dass ein alter, spaeter ausgefuehrter Freigabe-Callback zurueckschreibt. */
    private long letzteBildFreigabeNs = Long.MIN_VALUE;
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
    /** Laufende Nummer fuer zusammengehoerende Debug-Zeilen eines Rundenbefehls. */
    private long frameDiagnoseBefehl;
    /** Der normale Live-Takt darf im Debug-Protokoll hoechstens einmal je Sekunde stehen. */
    private long letzteFrameDiagnose;
    /** Zwischen lokalem Play-Wunsch und dem autoritativen syncstart bleibt das Bild stehen. */
    private boolean gemeinsamerStartOffen;

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
        final long diagnoseId;
        JSONObject urteil;
        final Runnable bereit;
        boolean rechnet;
        boolean angewendet;
        double ziel;
        /** Wann losgelassen wird - Uhrzeit des Geraets. 0: sobald es geht. */
        long startBei;
        /** Bis wann ein genauer Sprung nachgemessen und hoechstens dreimal nachgesetzt wird. */
        long genauBis;
        int sprungVersuche;
        boolean ungenauGemeldet;
        /** Kleinste Callback-Folge, die nach dem letzten seekTo als frisch gilt. */
        long erwarteteBildFolge;
        /** Kanonischer Bild-PTS; NaN, wenn der Befehl nur eine Laufzeit traegt. */
        double frameZiel = Double.NaN;
        Befehl(long diagnoseId, JSONObject urteil, Runnable bereit) {
            this.diagnoseId = diagnoseId;
            this.urteil = urteil;
            this.bereit = bereit;
        }
    }

    /** Nur Debug-Bauten: Zahlen, die den nativen Frame-Sprung erklaeren, ohne Quelladressen. */
    private void frameDiagnose(String schritt, Befehl befehl, double eingangsFrame) {
        if (!frameDiagnoseAktiv()) return;
        ExoPlayer lauf = player;
        Log.d(FRAME_LOG, String.format(Locale.US,
            "%s id=%d tun=%s inputFrame=%.6f target=%.6f frameTarget=%.6f "
                + "position=%.6f rawFrame=%.6f frameRate=%.3f frameTolerance=%.6f "
                + "frameSerial=%d expectedSerial=%d state=%d ready=%s playing=%s attempts=%d "
                + "hlsAnchor=%s",
            schritt,
            befehl == null ? 0 : befehl.diagnoseId,
            befehl == null || befehl.urteil == null ? "" : befehl.urteil.optString("tun", ""),
            eingangsFrame,
            befehl == null ? Double.NaN : befehl.ziel,
            befehl == null ? Double.NaN : befehl.frameZiel,
            lauf == null ? Double.NaN : lauf.getCurrentPosition() / 1000.0,
            letzteBildZeit,
            letzteBildRate,
            frameToleranz(letzteBildRate),
            letzteBildFolge,
            befehl == null ? 0 : befehl.erwarteteBildFolge,
            lauf == null ? -1 : lauf.getPlaybackState(),
            lauf != null && lauf.getPlaybackState() == Player.STATE_READY,
            lauf != null && lauf.isPlaying(),
            befehl == null ? 0 : befehl.sprungVersuche,
            hlsZeit == null ? "none" : hlsZeit.zustand()));
    }

    private boolean frameDiagnoseAktiv() {
        return (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static double frameAus(JSONObject urteil) {
        if (urteil == null) return Double.NaN;
        JSONObject ereignis = urteil.optJSONObject("ereignis");
        return ereignis == null
            ? urteil.optDouble("frameTime", Double.NaN)
            : ereignis.optDouble("frameTime", urteil.optDouble("frameTime", Double.NaN));
    }

    /** Ein Ziel zwischen zwei Bildern darf auf das naechste Bild dieser Spur fallen. */
    static double frameToleranz(double bildrate) {
        if (!Double.isFinite(bildrate) || bildrate <= 0) return SEEK_TOLERANZ_S;
        return Math.max(SEEK_TOLERANZ_S, Math.min(0.1, 1.0 / bildrate + 0.002));
    }

    /** Reiner Teil der Bereitschaftsregel, damit ihre Grenzfaelle ohne Android pruefbar sind. */
    static boolean genauerFramePasst(double position, double positionsZiel,
        double bildZeit, double frameZiel, double bildrate,
        long bildFolge, long erwarteteBildFolge) {
        return Math.abs(position - positionsZiel) <= SEEK_TOLERANZ_S
            && bildFolge >= erwarteteBildFolge
            && Double.isFinite(bildZeit) && Double.isFinite(frameZiel)
            && Math.abs(bildZeit - frameZiel) <= frameToleranz(bildrate);
    }

    /**
     * Bei einem echten Sprung ist erst der naechste Callback frisch. Ist Stelle
     * und sichtbares Bild schon passend, darf Media3 seekTo als No-op behandeln.
     */
    static long bildFolgeNachSeek(long bildFolge, double position, double positionsZiel,
        double bildZeit, double frameZiel, double bildrate) {
        return genauerFramePasst(position, positionsZiel, bildZeit, frameZiel, bildrate,
            bildFolge, bildFolge) ? bildFolge : bildFolge + 1;
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
        zehnZurueck = unten.findViewWithTag("zehnZurueck");
        zehnVor = unten.findViewWithTag("zehnVor");
        ton = unten.findViewWithTag("ton");
        automatisch = unten.findViewWithTag("auto");
        tempoText = unten.findViewWithTag("tempo");
        intro = unten.findViewWithTag("intro");
        spulenZeichnen();

        // Kringel und Ansage stehen untereinander in einer Spalte, nicht
        // uebereinander in der Mitte: nebeneinandergelegt dreht sich der Kringel
        // sonst hinter dem Text, und beides ist schlechter zu lesen als jedes
        // fuer sich. Sie beantworten dieselbe Frage - "warum sehe ich nichts?" -
        // und gehoeren deshalb zusammen.
        mitte = new LinearLayout(activity);
        mitte.setOrientation(LinearLayout.VERTICAL);
        mitte.setGravity(Gravity.CENTER);
        mitte.setPadding(dp(24), 0, dp(24), 0);
        // Der Knopf in der Mitte - derselbe wie am Rechner (#mitteSpielen in
        // spieler.html). Er steht dort, wo der Blick ohnehin ist, und ist mit
        // dem Steuerkreuz das Erste, was man findet. Wann er weichen muss,
        // steht in mitteZeichnen().
        mitteSpielen = new TextView(activity);
        mitteSpielen.setText("▶");
        mitteSpielen.setTextColor(SCHRIFT);
        mitteSpielen.setTextSize(24);
        mitteSpielen.setGravity(Gravity.CENTER);
        mitteSpielen.setVisibility(View.GONE);
        mitteSpielen.setBackground(flaeche(MITTE_KNOPF, 38, RAHMEN, 1));
        anfassbar(mitteSpielen, 38, this::spielenUmschalten);
        mitte.addView(mitteSpielen, new LinearLayout.LayoutParams(dp(76), dp(76)));
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
        blendeReiter = blende.findViewWithTag("reiter");
        blendeLeer = blende.findViewWithTag("leer");

        ansage = new TextView(activity);
        ansage.setTextColor(SCHRIFT);
        ansage.setTextSize(13);
        ansage.setGravity(Gravity.CENTER);
        ansage.setPadding(dp(16), dp(9), dp(16), dp(10));
        ansage.setBackground(flaeche(Color.parseColor("#EE0A0E16"), 999, RAHMEN, 1));
        ansage.setVisibility(View.GONE);
        FrameLayout.LayoutParams ansageLage =
            new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        ansageLage.topMargin = dp(86);
        ansicht.addView(ansage, ansageLage);

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
        TextView zurueck = knopf("−10 s", () -> springen(-10));
        zurueck.setTag("zehnZurueck");
        knoepfe.addView(zurueck);
        TextView vor = knopf("+10 s", () -> springen(10));
        vor.setTag("zehnVor");
        knoepfe.addView(vor);
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
        TextView tempoKnopf = knopf("1×", this::tempoWaehlen);
        tempoKnopf.setTag("tempo");
        knoepfe.addView(tempoKnopf);
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
                stelleVomNutzerSetzen(ziel);
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

        // Die Reiterzeile - dieselbe wie am Rechner (#staffelReiter). Sie
        // bleibt leer, wo es nichts zu blaettern gibt: eine Zeile mit einem
        // einzigen Reiter entscheidet nichts.
        Fliessreihe reiter = new Fliessreihe(activity, dp(3), dp(3));
        reiter.setTag("reiter");
        reiter.setVisibility(View.GONE);
        LinearLayout.LayoutParams reiterLage = new LinearLayout.LayoutParams(-1, -2);
        reiterLage.topMargin = dp(8);
        spalte.addView(reiter, reiterLage);

        TextView leer = new TextView(activity);
        leer.setTag("leer");
        leer.setTextColor(SCHRIFT_LEISE);
        leer.setTextSize(13);
        leer.setPadding(dp(4), dp(10), dp(4), dp(4));
        leer.setVisibility(View.GONE);
        spalte.addView(leer, new LinearLayout.LayoutParams(-1, -2));

        ScrollView schiene = new ScrollView(activity);
        schiene.setTag("schiene");
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
        mitteZeichnen();
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
        mitteZeichnen();
        regung();
    }

    /**
     * Eine Ansage, die von selbst wieder geht.
     *
     * <p>1,2 Sekunden - lang genug zum Lesen einer Zeile, kurz genug, dass
     * niemand darauf wartet. Ein neuer Text stellt die Uhr zurueck, statt zwei
     * Ansagen uebereinanderzulegen.
     */
    void kurzeAnsage(String text) {
        handler.removeCallbacks(ansageWeg);
        if (text == null || text.trim().isEmpty()) { ansageVerbergen(); return; }
        ansage.setText(text);
        if (ansage.getVisibility() != View.VISIBLE) {
            ansage.setVisibility(View.VISIBLE);
            Bewegung.einblenden(ansage);
        }
        handler.postDelayed(ansageWeg, ANSAGE_MS);
        regung();
    }

    /** So lange steht eine kurze Ansage. */
    private static final long ANSAGE_MS = 1200;

    private final Runnable ansageWeg = this::ansageVerbergen;

    private void ansageVerbergen() {
        if (ansage.getVisibility() != View.VISIBLE) return;
        ansage.setVisibility(View.GONE);
    }

    private void kastenKnopf(String text, Runnable aktion) {
        // Der erste Knopf im Kasten ist der gemeinte - er traegt die Akzentflaeche.
        TextView knopf = knopf(text, aktion, kastenKnoepfe.getChildCount() == 0);
        kastenKnoepfe.addView(knopf);
        kastenKnoepfe.setVisibility(View.VISIBLE);
    }

    /**
     * Ob der Player gerade auf etwas wartet.
     *
     * <p>{@code false} raeumt Kringel und Ansage weg - fuer den Fall, in dem
     * nichts mehr kommt, weil nichts mehr kommen soll: die Serienseite, auf der
     * gewaehlt und nicht gespielt wird. Ohne das drehte sich hinter der
     * offenen Folgenliste bis in alle Ewigkeit ein Ladekringel.
     */
    void warten(boolean ja) {
        puffer.setVisibility(ja ? View.VISIBLE : View.GONE);
        if (!ja) kastenZu();
        mitteZeichnen();
    }

    private void kastenZu() {
        kasten.setVisibility(View.GONE);
        kastenKnoepfe.removeAllViews();
        mitteZeichnen();
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

    /**
     * Abspielen und Pause.
     *
     * <p>In einer Runde faengt niemand allein an. Wer drueckt, bleibt stehen und
     * meldet die Absicht; die Runde nennt einen Zeitpunkt, und dann fahren alle
     * gemeinsam los (siehe {@code meldungSenden} in der Bruecke und
     * {@code startPlan} im geteilten Modul). Vorher lief der Ausloeser sofort und
     * die anderen holten auf - der Rueckstand war die Laufzeit der Nachricht
     * plus Springen und Puffern, und er blieb, weil der laufende Ausgleich erst
     * bei fuenf Sekunden eingreift.
     */
    private void spielenUmschalten() {
        if (player == null) return;
        if (player.getPlayWhenReady() || gemeinsamerStartOffen || wartenderBefehl != null) pauseAnfordern();
        else abspielenAnfordern();
    }

    /** PLAY ist kein Umschalter: laufend oder bereits angefordert bleibt laufend. */
    private void abspielenAnfordern() {
        if (player == null || player.getPlayWhenReady() || gemeinsamerStartOffen
            || wartenderBefehl != null) return;
        if (umgebung.inRunde() && bereitGemeldet) startAngefordert();
        else player.play();
        spielenZeichnen();
    }

    /**
     * PAUSE geht auch dann ausdruecklich ans Relay, wenn der lokale Player fuer
     * die Startschranke oder durch den Lebenszyklus bereits angehalten ist.
     */
    private void pauseAnfordern() {
        if (player == null) return;
        boolean melden = umgebung.inRunde() && bereitGemeldet;
        gemeinsamerStartOffen = false;
        wartenderBefehl = null;
        handler.removeCallbacks(startNotbremse);
        erwartetPlay = false;
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        player.pause();
        if (melden) liveMelden("pause");
        spielenZeichnen();
        regung();
    }

    /** Laeuft gerade ein Anlauf zum gemeinsamen Start? */
    private final Runnable startNotbremse = this::startNotbremseZiehen;

    private void startAngefordert() {
        handler.removeCallbacks(startNotbremse);
        gemeinsamerStartOffen = true;
        spielenZeichnen();
        liveMelden("play");
        // Antwortet die Runde nicht, darf dieses Geraet nicht allein anfangen.
        // Nach Ablauf wird nur der Knopf wieder freigegeben, damit ein neuer
        // Versuch moeglich ist.
        handler.postDelayed(startNotbremse, 5500);
        regung();
    }

    private void startNotbremseZiehen() {
        if (geschlossen || player == null || player.getPlayWhenReady() || wartenderBefehl != null) return;
        gemeinsamerStartOffen = false;
        spielenZeichnen();
    }

    private void spielenZeichnen() {
        mitteZeichnen();
    }

    /* ---------------------------------------------------------------- Das Tempo
     *
     * Dieselbe Leiter wie am Rechner (TEMPO_STUFEN in spieler.js) und dieselbe
     * Regel: allein stellt sie jeder, in einer Runde nur der Host. Zwei Geraete
     * mit verschiedenem Tempo laufen unweigerlich auseinander, und kein
     * Abgleich holt das wieder ein.
     */
    private static final double[] TEMPO_STUFEN = {0.5, 0.75, 1, 1.25, 1.5, 2};

    /** Das laufende Tempo. In einer Runde ist es das der Runde. */
    private double tempo = 1;

    private static String tempoName(double wert) {
        String zahl = String.format(Locale.GERMANY, "%.2f", wert)
            .replaceAll("0+$", "").replaceAll("[.,]$", "");
        return zahl + "×";
    }

    /** Auf eine der Stufen zwingen - was hereinkommt, kommt aus einer Nachricht. */
    private static double tempoStufe(double wert) {
        if (!(wert > 0)) return 1;
        double beste = 1;
        for (double stufe : TEMPO_STUFEN) {
            if (Math.abs(stufe - wert) < Math.abs(beste - wert)) beste = stufe;
        }
        return beste;
    }

    /**
     * Das Tempo setzen.
     *
     * @param melden ob es an die Runde geht. Was von dort kam, geht nicht
     *               zurueck - sonst haette jede Einstellung ein Echo.
     */
    private void tempoSetzen(double wert, boolean melden) {
        tempo = tempoStufe(wert);
        if (player != null) player.setPlaybackSpeed((float) tempo);
        if (tempoText != null) tempoText.setText(tempoName(tempo));
        if (melden) umgebung.tempo(tempo);
    }

    /** Die Auswahl in derselben Blende wie Fassung, Hoster und Qualitaet. */
    private void tempoWaehlen() {
        if (!umgebung.darfTempo()) {
            kurzeAnsage("In einer Runde stellt der Host das Tempo.");
            return;
        }
        ArrayList<String> namen = new ArrayList<>();
        ArrayList<Runnable> aktionen = new ArrayList<>();
        int laufend = -1;
        for (int i = 0; i < TEMPO_STUFEN.length; i++) {
            final double stufe = TEMPO_STUFEN[i];
            if (Math.abs(stufe - tempo) < 0.001) laufend = i;
            namen.add(tempoName(stufe));
            aktionen.add(() -> tempoSetzen(stufe, true));
        }
        blende("Tempo", namen, aktionen, laufend);
    }

    /**
     * Der Knopf in der Mitte - er steht nur, wenn er dort allein steht.
     *
     * <p>In der Mitte liegen vier Dinge uebereinander: der Kringel des Puffers,
     * der Kasten mit Ansage und Knoepfen, die Blende der Listen - und dieser
     * Knopf. Sie beantworten verschiedene Fragen, und zwei davon gleichzeitig
     * beantwortet keine. Der Knopf tritt deshalb zurueck, sobald eines der
     * anderen dasteht, und ebenso mit der uebrigen Bedienung.
     */
    private void mitteZeichnen() {
        boolean laeuft = player != null && player.getPlayWhenReady();
        boolean startOffen = player != null && gemeinsamerStartOffen;
        String zeichen = laeuft || startOffen ? "❚❚" : "▶";
        String beschreibung = startOffen ? "Gemeinsamen Start abbrechen"
            : laeuft ? "Pause" : "Abspielen";
        // Leiste und Mitte sind zwei Ansichten desselben Befehls. Beide
        // muessen deshalb denselben Zustand aus genau derselben Rechnung
        // zeigen, gerade waehrend Media3 fuer den gemeinsamen Start noch
        // angehalten bleibt und selbst kein Zustandsereignis ausloest.
        spielen.setText(zeichen);
        spielen.setContentDescription(beschreibung);
        mitteSpielen.setText(zeichen);
        mitteSpielen.setContentDescription(beschreibung);
        boolean frei = schichtenAn && player != null
            && puffer.getVisibility() != View.VISIBLE
            && kasten.getVisibility() != View.VISIBLE
            && blende.getVisibility() != View.VISIBLE;
        if (frei == (mitteSpielen.getVisibility() == View.VISIBLE)) return;
        mitteSpielen.setVisibility(frei ? View.VISIBLE : View.GONE);
        if (frei) Bewegung.einblenden(mitteSpielen);
    }

    private void springen(int sekunden) {
        if (player == null) return;
        double ziel = Math.max(0, position() + sekunden);
        if (dauer() > 0) ziel = Math.min(ziel, dauer() - 0.5);
        stelleVomNutzerSetzen(ziel);
    }

    /** Eine lokale Spulhandlung; Befehle der Runde laufen bewusst nicht hier hindurch. */
    private boolean stelleVomNutzerSetzen(double ziel) {
        if (player == null) return false;
        if (!darfNutzerSpulen()) {
            kurzeAnsage("Spulen steuert der Host.");
            spulenZeichnen();
            return false;
        }
        erwartetSeek = ziel;
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        player.seekTo(Math.round(ziel * 1000));
        liveMelden("seek");
        return true;
    }

    static boolean darfNutzerSpulen(boolean inRunde, boolean istHost) {
        return !inRunde || istHost;
    }

    private boolean darfNutzerSpulen() {
        return !umgebung.inRunde() || umgebung.istRundenHost();
    }

    /** Die aktuelle Relay-Rolle wird bei jedem Takt neu gelesen, auch nach einer Hostuebergabe. */
    private void spulenZeichnen() {
        boolean frei = darfNutzerSpulen();
        String gesperrt = "Spulen steuert der Host";
        regler.setEnabled(frei);
        regler.setAlpha(frei ? 1f : 0.42f);
        regler.setContentDescription(frei ? "Wiedergabestelle" : gesperrt);
        spulknopfZeichnen(zehnZurueck, frei, "10 Sekunden zurück", gesperrt);
        spulknopfZeichnen(zehnVor, frei, "10 Sekunden vor", gesperrt);
        spulknopfZeichnen(intro, frei, "Intro überspringen", gesperrt);
    }

    private static void spulknopfZeichnen(TextView knopf, boolean frei,
        String beschreibung, String gesperrt) {
        knopf.setEnabled(frei);
        knopf.setAlpha(frei ? 1f : 0.42f);
        knopf.setContentDescription(frei ? beschreibung : gesperrt);
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
        stelleVomNutzerSetzen(introZiel);
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
    /**
     * Eine Zeile der Blende.
     *
     * <p>Zwei Spalten und nicht eine: links die Nummer, rechts der Name -
     * genau wie in der Folgenliste am Rechner ({@code .liste .nummer} in
     * spieler.html). "Folge 7 - Der Name" in einer Zeile las sich als ein
     * einziger langer Satz, und bei vierundzwanzig Folgen untereinander stand
     * die Nummer jedes Mal woanders. Ohne Nummer bleibt die Spalte weg.
     */
    static final class Zeile {
        final String nummer;
        final String text;
        final Runnable tun;
        final boolean aus;

        Zeile(String nummer, String text, Runnable tun, boolean aus) {
            this.nummer = nummer == null ? "" : nummer;
            this.text = text == null ? "" : text;
            this.tun = tun;
            this.aus = aus;
        }

        static Zeile schlicht(String text, Runnable tun) {
            return new Zeile("", text, tun, false);
        }
    }

    /**
     * Eine Liste von rechts - Quellen, Spuren, Tempo.
     *
     * <p>Sie ersetzt die Systemdialoge, die vorher an drei Stellen aufgingen:
     * die haben ihre eigene Gestaltung, ihre eigene Schrift und am Fernseher
     * ihre eigene Bedienung. Eine Liste, die zur App gehoert, gehoert in die App.
     *
     * @param laufend Zeile, die gerade gilt - sie bekommt die Akzentflaeche. -1 fuer keine.
     */
    void blende(String name, List<String> eintraege, List<Runnable> aktionen, int laufend) {
        List<Zeile> zeilen = new ArrayList<>();
        for (int i = 0; i < eintraege.size(); i++) {
            final int index = i;
            zeilen.add(Zeile.schlicht(eintraege.get(i),
                () -> { if (index < aktionen.size()) aktionen.get(index).run(); }));
        }
        blende(name, null, -1, null, zeilen, laufend, "");
    }

    /**
     * Dieselbe Blende mit Reiterzeile - die Staffeln.
     *
     * <p>Vorher standen die Staffeln als Zeilen *in* der Liste ("Staffel 2
     * oeffnen"), oberhalb der Folgen. Am Rechner sind sie eine Reiterzeile, und
     * das ist der Unterschied, den man sieht: Reiter sagen "hier waehlst du
     * aus, welche Liste du siehst", Zeilen sagen "das gehoert zur Liste". Bei
     * fuenf Staffeln und vierundzwanzig Folgen war die halbe erste Bildschirm-
     * seite mit Staffeln gefuellt, bevor die erste Folge kam.
     *
     * @param reiter      Beschriftungen der Reiter, {@code null} fuer keine Zeile
     * @param reiterAktiv welcher Reiter aufgeschlagen ist
     * @param reiterWahl  was ein Reiter tut - die Blende bleibt dabei offen
     * @param leerText    steht statt der Liste, wenn keine Zeile da ist
     */
    void blende(String name, List<String> reiter, int reiterAktiv,
                java.util.function.IntConsumer reiterWahl,
                List<Zeile> zeilen, int laufend, String leerText) {
        if (geschlossen) return;
        blendeTitel.setText(name);

        blendeReiter.removeAllViews();
        boolean hatReiter = reiter != null && reiter.size() > 1;
        blendeReiter.setVisibility(hatReiter ? View.VISIBLE : View.GONE);
        if (hatReiter) {
            for (int i = 0; i < reiter.size(); i++) {
                final int index = i;
                blendeReiter.addView(reiterKnopf(reiter.get(i), i == reiterAktiv,
                    () -> { if (reiterWahl != null) reiterWahl.accept(index); }));
            }
        }

        blendeListe.removeAllViews();
        for (int i = 0; i < zeilen.size(); i++) {
            blendeListe.addView(blendeZeile(zeilen.get(i), i == laufend));
        }
        boolean leer = leerText != null && !leerText.isEmpty();
        blendeLeer.setText(leer ? leerText : "");
        blendeLeer.setVisibility(leer ? View.VISIBLE : View.GONE);

        blende.getLayoutParams().width = Math.min(dp(420),
            Math.round(activity.getResources().getDisplayMetrics().widthPixels * 0.92f));
        boolean warOffen = blende.getVisibility() == View.VISIBLE;
        blende.setVisibility(View.VISIBLE);
        mitteZeichnen();
        blende.requestLayout();
        regung();
        // Die laufende Zeile ist die, von der aus man weitersucht - am
        // Fernseher steht das Steuerkreuz damit sofort dort, wo man ist. Gibt
        // es keine, ist der erste Eintrag der wahrscheinlichste.
        View ziel = laufend >= 0 && laufend < blendeListe.getChildCount()
            ? blendeListe.getChildAt(laufend)
            : blendeListe.getChildCount() > 0 ? blendeListe.getChildAt(0) : null;
        if (ziel != null) ziel.requestFocus();
        else if (hatReiter && blendeReiter.getChildCount() > 0) blendeReiter.getChildAt(0).requestFocus();
        // Beim Blaettern zwischen Staffeln steht sie schon da - ein zweites
        // Einblenden waere ein Blinken ohne Anlass.
        if (!warOffen) Bewegung.einblenden(blende);
    }

    /** Ein Reiter der Blende - aufgeschlagen traegt er die Akzentflaeche, wie {@code .reiter .aktiv}. */
    private TextView reiterKnopf(String text, boolean aktiv, Runnable tun) {
        TextView knopf = new TextView(activity);
        knopf.setText(text);
        knopf.setTextColor(SCHRIFT);
        knopf.setTextSize(13);
        knopf.setGravity(Gravity.CENTER);
        knopf.setMinHeight(dp(40));
        knopf.setPadding(dp(12), dp(8), dp(12), dp(8));
        if (aktiv) knopf.setTypeface(Typeface.DEFAULT_BOLD);
        knopf.setBackground(flaeche(aktiv ? Theme.PRIMARY : ZEILE, 9, 0, 0));
        anfassbar(knopf, 9, tun);
        return knopf;
    }

    /** Eine Zeile der Liste - Nummernspalte links, Name rechts. */
    private View blendeZeile(Zeile eintrag, boolean laeuft) {
        LinearLayout reihe = new LinearLayout(activity);
        reihe.setOrientation(LinearLayout.HORIZONTAL);
        reihe.setGravity(Gravity.CENTER_VERTICAL);
        reihe.setMinimumHeight(dp(48));
        reihe.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams lage = new LinearLayout.LayoutParams(-1, -2);
        lage.bottomMargin = dp(4);
        reihe.setLayoutParams(lage);

        if (!eintrag.nummer.isEmpty()) {
            TextView nummer = new TextView(activity);
            nummer.setText(eintrag.nummer);
            nummer.setTextColor(SCHRIFT_LEISE);
            nummer.setTextSize(14);
            nummer.setMinWidth(dp(66));
            reihe.addView(nummer);
        }
        TextView name = new TextView(activity);
        name.setText(eintrag.text);
        name.setTextColor(SCHRIFT);
        name.setTextSize(14);
        if (laeuft) name.setTypeface(Typeface.DEFAULT_BOLD);
        reihe.addView(name, new LinearLayout.LayoutParams(0, -2, 1f));

        reihe.setBackground(flaeche(laeuft ? Theme.PRIMARY_MUTED : ZEILE, 10, 0, 0));
        if (eintrag.aus) {
            // Gesperrt heisst: die Nummer steht in der Liste, aber dahinter
            // liegt keine eigene Folge. Anklickbar waere sie ein Versprechen,
            // das die Anbieterseite nicht haelt.
            reihe.setAlpha(0.38f);
            return reihe;
        }
        anfassbar(reihe, 10, () -> {
            blendeZu();
            if (eintrag.tun != null) eintrag.tun.run();
        });
        return reihe;
    }

    private void blendeZu() {
        if (blende.getVisibility() != View.VISIBLE) return;
        blende.setVisibility(View.GONE);
        blendeListe.removeAllViews();
        blendeReiter.removeAllViews();
        blendeLeer.setVisibility(View.GONE);
        mitteZeichnen();
        regung();
    }

    boolean blendeOffen() {
        return blende.getVisibility() == View.VISIBLE;
    }

    /* -------------------------------------------------------------- Die Quelle */

    /**
     * Wie weit vorgeladen wird - und wie weit zurueck behalten.
     *
     * <p>Dieselben Zahlen wie am Rechner (hlsStarten in spieler.js: 60 Sekunden
     * voraus, 30 zurueck). ExoPlayer haelt von sich aus nichts hinter der
     * Wiedergabestelle, und genau daran hing die gemeldete Zaeherei: <b>jedes</b>
     * Pausieren und Starten aus einer Runde ist ein Sprung. Der Befehl aus der
     * Watchparty setzt die Stelle des Absenders, und die liegt fast immer ein
     * Stueck hinter der eigenen. Ohne Rueckpuffer wirft ExoPlayer dabei alles
     * Geladene weg und holt das ganze Stueck neu - bei Vidmoly sind das
     * 15-Sekunden-Stuecke, also Sekunden schwarzes Bild bei jedem Takt der
     * Runde. Mit Rueckpuffer sitzt die Stelle im Geladenen und der Sprung
     * kostet nichts.
     *
     * <p>Die zweite Zahl ist die Schwelle zum Weiterspielen: 1,5 Sekunden statt
     * der voreingestellten 2,5, nach einem Nachladen 3 statt 5. Wer in einer
     * Runde sitzt, wartet sonst laenger als alle anderen.
     *
     * <p>{@code setPrioritizeTimeOverSizeThresholds(true)}: die Zeit entscheidet,
     * nicht die Menge. Eine hohe Stufe fuellt den Byte-Vorrat sonst lange vor
     * den 60 Sekunden.
     */
    private DefaultLoadControl puffern() {
        return new DefaultLoadControl.Builder()
            .setBufferDurationsMs(30_000, 60_000, 1_500, 3_000)
            .setBackBuffer(30_000, true)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();
    }

    void quelle(String url, String typ, Map<String, String> kopfzeilen, double start) {
        freigeben();
        if (geschlossen) return;
        quelleLaedt = true;
        OkHttpDataSource.Factory netz = new OkHttpDataSource.Factory(CookieNetz.erstellen())
            .setDefaultRequestProperties(kopfzeilen);
        KanonischesHls hls = "hls".equals(typ)
            ? new KanonischesHls(netz, meldung -> {
                if (frameDiagnoseAktiv()) Log.d(FRAME_LOG, "hls-anchor " + meldung);
            }) : null;
        hlsZeit = hls;
        player = new ExoPlayer.Builder(activity)
            .setMediaSourceFactory(new DefaultMediaSourceFactory(netz))
            .setLoadControl(puffern())
            .setSeekBackIncrementMs(10000).setSeekForwardIncrementMs(30000).build();
        player.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true);
        player.setHandleAudioBecomingNoisy(true);
        // Genau springen, nicht auf das naechste Schluesselbild davor. In einer
        // Runde schauen alle auf dasselbe Bild - "ungefaehr dort" waere bei den
        // 15-Sekunden-Stuecken der Hoster bis zu fuenfzehn Sekunden daneben.
        player.setSeekParameters(SeekParameters.EXACT);
        bild.setPlayer(player);
        ExoPlayer lauf = player;
        lauf.setVideoFrameMetadataListener(new VideoFrameMetadataListener() {
            @Override public void onVideoFrameAboutToBeRendered(long presentationTimeUs,
                long releaseTimeNs, Format format, android.media.MediaFormat mediaFormat) {
                // Der Horcher wird kurz vor der Ausgabe gerufen. Erst zur von
                // Media3 genannten Freigabezeit gilt der PTS als das sichtbare
                // Bild; vorher duerfte eine Bereitschaft den Start zu frueh
                // freigeben. Alte Callbacks einer vorigen Quelle werden durch
                // die Player-Identitaet verworfen.
                long wartenNs = releaseTimeNs > 0
                    ? Math.max(0, releaseTimeNs - System.nanoTime()) : 0;
                long wartenMs = Math.min(1000, (wartenNs + 999_999) / 1_000_000);
                handler.postDelayed(() -> {
                    if (geschlossen || player != lauf || presentationTimeUs < 0
                        || releaseTimeNs < letzteBildFreigabeNs) return;
                    letzteBildFreigabeNs = releaseTimeNs;
                    letzteBildZeit = presentationTimeUs / 1_000_000.0;
                    letzteBildRate = format == null ? Double.NaN : format.frameRate;
                    letzteBildFolge += 1;
                    Befehl befehl = wartenderBefehl;
                    if (frameDiagnoseAktiv() && befehl != null && befehl.angewendet) {
                        frameDiagnose("frame-callback", befehl, Double.NaN);
                    }
                    befehlPruefen();
                }, wartenMs);
            }
        });
        lauf.addListener(new Player.Listener() {
            private boolean startGeprueft;
            @Override public void onPlaybackStateChanged(int state) {
                if (geschlossen || player != lauf) return;
                puffer.setVisibility(state == Player.STATE_BUFFERING ? View.VISIBLE : View.GONE);
                mitteZeichnen();
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
        long startMs = Math.max(0, Math.round(start * 1000));
        if (hls != null) lauf.setMediaSource(hls.fabrik().createMediaSource(item.build()), startMs);
        else lauf.setMediaItem(item.build(), startMs);
        lauf.prepare();
        // Ein neuer Player faengt bei einfachem Tempo an - auch mitten in einer
        // Runde, die auf 2x laeuft. Der Hosterwechsel ist genau der Fall.
        lauf.setPlaybackSpeed((float) tempo);
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
        // Ein gemeinsamer Start darf nicht mehr spaeter aus einer bereits
        // eingeplanten Runnable loslaufen, wenn der Player inzwischen den
        // Anbieter wechselt oder angehalten wurde.
        wartenderBefehl = null;
        gemeinsamerStartOffen = false;
        handler.removeCallbacks(startNotbremse);
        if (player != null) { erwartetPlay = false; erwartetBis = SystemClock.uptimeMillis() + 2000; player.pause(); }
    }

    void pause() {
        aktiv = false;
        zaehlerEnde = 0;
        endeAbgesagt = true;
        // Auch ein noch nicht faelliger gemeinsamer Start ist damit veraltet.
        // Ohne das blieb der Befehl bis zum Echo im Fach und konnte nach einem
        // kurzen Vordergrundwechsel wieder loslaufen.
        wartenderBefehl = null;
        gemeinsamerStartOffen = false;
        handler.removeCallbacks(startNotbremse);
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
        long ganz = (long) Math.floor(sekunden);
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
            spulenZeichnen();
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
        // Der lokale Play-Ereignishorcher wird erst aufgerufen, nachdem
        // ExoPlayer bereits auf playWhenReady=true gesetzt hat. In einer
        // Watchparty darf dieser kurze Vorsprung nicht zum Startzeitpunkt
        // werden: das Relay schickt den kanonischen Play-Echo mit dem
        // gemeinsamen startAt an alle, einschliesslich des Absenders. Bis
        // dahin bleibt der Ausloeser stehen.
        if ("play".equals(aktion) && umgebung.inRunde()) {
            gemeinsamerStartOffen = true;
            erwartetPlay = false;
            erwartetBis = SystemClock.uptimeMillis() + 2000;
            player.pause();
            spielenZeichnen();
        }
        if ("pause".equals(aktion) && umgebung.inRunde()) {
            // Ein Pause-Klick waehrend der Vorbereitungsphase widerruft auch
            // den noch nicht faelligen Startbefehl. Sonst koennte dessen
            // delayed callback nach dem Pause-Echo wieder play setzen.
            wartenderBefehl = null;
            gemeinsamerStartOffen = false;
            handler.removeCallbacks(startNotbremse);
            spielenZeichnen();
        }
        /*
         * Beim Anhalten geht der Ausloeser denselben Weg wie alle anderen: er
         * springt auf die Zahl, die er gerade verschickt hat.
         *
         * <p>Das klingt nach nichts und ist der Unterschied zwischen "dieselbe
         * Sekunde" und "dasselbe Bild". Ein Video, das im Laufen angehalten
         * wird, bleibt irgendwo zwischen zwei Bildern stehen; diese Zahl geht
         * an alle, die springen darauf und landen auf dem Bild darunter - ein
         * Video kann nur Bilder zeigen, die es gibt. Der Ausloeser bliebe als
         * Einziger dazwischen. Gemessen am Rechner mit drei Playern an einem
         * echten Relay (standbildtest.js): die Empfaenger waren untereinander
         * bitgleich, der Ausloeser lag jedes Mal ein Bild daneben.
         *
         * <p>Beim stehenden Bild kostet der Sprung nichts, und er ist der
         * einzige Weg, auf dem am Ende ueberall dasselbe steht - auch zwischen
         * Telefon und Rechner, die verschiedene Player benutzen.
         */
        if (!"pause".equals(aktion) || !umgebung.inRunde()) return;
        double stelle = position();
        double bildZeit = bildZeitNahe(stelle);
        long zielMs = Double.isFinite(bildZeit)
            ? frameSeekMillis(bildZeit) : Math.round(stelle * 1000);
        erwartetSeek = zielMs / 1000.0;
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        player.seekTo(zielMs);
    }

    JSONObject liveStand() throws org.json.JSONException {
        double stelle = position();
        boolean pausiert = player == null || !player.getPlayWhenReady();
        JSONObject stand = new JSONObject().put("position", stelle)
            .put("duration", player == null ? 0 : Math.max(0, player.getDuration()) / 1000.0)
            .put("paused", pausiert)
            .put("puffert", player == null || player.getPlaybackState() != Player.STATE_READY);
        double bildZeit = bildZeitNahe(stelle);
        if (pausiert && Double.isFinite(bildZeit)) stand.put("frameTime", bildZeit);
        if (frameDiagnoseAktiv()) {
            long jetzt = SystemClock.uptimeMillis();
            if (jetzt - letzteFrameDiagnose >= 900) {
                letzteFrameDiagnose = jetzt;
                frameDiagnose("live", wartenderBefehl, Double.NaN);
            }
        }
        return stand;
    }

    /** Nur ein PTS aus der Naehe kann zum gegenwaertig sichtbaren Bild gehoeren. */
    private double bildZeitNahe(double stelle) {
        return Double.isFinite(letzteBildZeit) && Math.abs(letzteBildZeit - stelle) <= 0.25
            ? letzteBildZeit : Double.NaN;
    }

    /**
     * Media3 zeigt beim genauen Sprung das erste Bild ab der Zielmillisekunde.
     * Der kanonische Bild-PTS wird deshalb abgerundet; das winzige Epsilon
     * gleicht nur die binaere Darstellung einer glatten Millisekunde aus.
     */
    private static long frameSeekMillis(double frameTime) {
        return Math.max(0, (long) Math.floor(frameTime * 1000.0 + 0.000001));
    }

    private static long befehlSeekMillis(Befehl befehl) {
        return Double.isFinite(befehl.frameZiel)
            ? frameSeekMillis(befehl.frameZiel) : Math.max(0, Math.round(befehl.ziel * 1000));
    }

    /* ------------------------------------------------------------- Die Watchparty */

    void steuern(JSONObject urteil, Runnable bereit) {
        if (geschlossen) return;
        String tun = urteil.optString("tun");
        if ("drift".equals(tun) || "nichts".equals(tun)) return;
        // Tempo und Fassung stellen ein, sie steuern nicht: kein Anhalten, kein
        // Sprung, keine Warteschlange. Sie gehen deshalb sofort durch und nicht
        // ueber befehlPruefen.
        if ("tempo".equals(tun)) {
            tempoSetzen(urteil.optDouble("tempo", 1), false);
            return;
        }
        if ("fassung".equals(tun)) {
            umgebung.fassungWaehlen(urteil.optString("fassung", ""), urteil.optString("hoster", ""));
            return;
        }
        // Eine Vorbereitung ohne syncId ist das manuelle, reine Gleichziehen:
        // danach bleibt das Bild stehen und der Knopf bietet wieder Play an.
        // Nur die Barrier-Runde wartet wirklich auf ein spaeteres syncstart.
        gemeinsamerStartOffen = "syncstart".equals(tun)
            || ("syncprepare".equals(tun) && !urteil.optString("syncId", "").isEmpty());
        handler.removeCallbacks(startNotbremse);
        wartenderBefehl = new Befehl(++frameDiagnoseBefehl, urteil, bereit);
        frameDiagnose("received", wartenderBefehl, frameAus(urteil));
        // syncprepare und ein Timeout-Pause-Echo veraendern bei bereits
        // stehendem Player keinen Media3-Zustand. Der Knopf muss trotzdem in
        // demselben UI-Takt auf Abbrechen beziehungsweise Abspielen wechseln.
        spielenZeichnen();
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
                // Der verabredete Zeitpunkt. Er wird hier gesetzt und nicht
                // beim Empfang der Nachricht: das Rechnen geht durch den Kern,
                // und die Millisekunden dorthin und zurueck gehoeren in die
                // Spanne, nicht davor.
                long vorlauf = Math.max(0, befehl.urteil.optLong("wartenMs", 0));
                // Relay-Steuerungen tragen startAt in der gemeinsamen
                // Serverzeit. wartenMs aus einer lokalen Antwort waere hier
                // falsch: zwischen WebSocket, Kern und UI vergeht bereits
                // ein Teil des Vorlaufs. Mit dem mitgereichten Uhrversatz
                // wird die Frist auf die lokale Wanduhr und danach auf die
                // monotone Player-Uhr umgerechnet.
                JSONObject ereignis = befehl.urteil.optJSONObject("ereignis");
                long startAt = ereignis == null ? 0 : ereignis.optLong("startAt", 0);
                if (startAt <= 0) startAt = befehl.urteil.optLong("startAt", 0);
                double frameTime = ereignis == null
                    ? befehl.urteil.optDouble("frameTime", Double.NaN)
                    : ereignis.optDouble("frameTime", befehl.urteil.optDouble("frameTime", Double.NaN));
                String tun = befehl.urteil.optString("tun", "");
                boolean frameBefehl = "syncprepare".equals(tun) || startAt > 0
                    || (ereignis != null && !ereignis.optBoolean("playing", false));
                if (frameBefehl && Double.isFinite(frameTime)) befehl.frameZiel = Math.max(0, frameTime);
                boolean hatUhr = ereignis != null && ereignis.optBoolean("hatUhr", false);
                long versatz = ereignis == null ? befehl.urteil.optLong("versatz", 0)
                    : ereignis.optLong("versatz", befehl.urteil.optLong("versatz", 0));
                long serverJetzt = System.currentTimeMillis() + versatz;
                // Ist ein geplanter Start bereits vorbei, traegt position die
                // nachgeholte Laufzeit. Der alte Startframe waere dann ein
                // Ruecksprung und darf die kompensierte Stelle nicht ersetzen.
                if (startAt > 0 && hatUhr && startAt < serverJetzt - 1) {
                    befehl.frameZiel = Double.NaN;
                }
                if (startAt > 0 && hatUhr) {
                    vorlauf = Math.max(0, startAt - serverJetzt);
                }
                befehl.startBei = vorlauf > 0 ? SystemClock.uptimeMillis() + vorlauf : 0;
                befehl.genauBis = SystemClock.uptimeMillis() + 2200;
                befehl.angewendet = true;
                erwartetBis = SystemClock.uptimeMillis() + 2000;
                erwartetPlay = false;
                player.pause();
                frameDiagnose("computed", befehl, frameTime);
                // Springen - aber nicht um jeden Preis.
                //
                // Beim Anhalten schon: dann stehen alle auf demselben Bild, und
                // genau darauf schaut man. Da zaehlt die Millisekunde, und ein
                // Sprung kostet hier nichts, weil ohnehin niemand laeuft.
                //
                // Beim Weiterlaufen dagegen ist ein Sprung auf die Stelle, auf
                // der man ohnehin steht, kein Sprung, sondern ein Aufsetzen: der
                // Decoder wird geleert, und das Bild kommt vom Anfang des
                // Stuecks zurueck. Ein halber Sekundenbruchteil sieht dort
                // niemand - die Runde greift erst bei fuenf Sekunden ein.
                boolean laeuftDanach = !befehl.urteil.optBoolean("warten")
                    && befehl.urteil.optJSONObject("ereignis") != null
                    && befehl.urteil.optJSONObject("ereignis").optBoolean("playing");
                boolean nahGenug = laeuftDanach && !Double.isFinite(befehl.frameZiel)
                    && Math.abs(position() - befehl.ziel) <= SPRUNG_AB_SEKUNDEN;
                if (!befehl.urteil.optBoolean("nichtSpringen") && !nahGenug) {
                    long zielMs = befehlSeekMillis(befehl);
                    erwartetSeek = zielMs / 1000.0;
                    befehl.erwarteteBildFolge = bildFolgeNachSeek(letzteBildFolge,
                        position(), zielMs / 1000.0, letzteBildZeit, befehl.frameZiel, letzteBildRate);
                    frameDiagnose("seek", befehl, frameTime);
                    player.seekTo(zielMs);
                }
                handler.postDelayed(this::befehlPruefen, 100);
            });
            return;
        }
        boolean mitFrame = Double.isFinite(befehl.frameZiel);
        double positionsZiel = mitFrame
            ? frameSeekMillis(befehl.frameZiel) / 1000.0 : befehl.ziel;
        double positionsAbstand = Math.abs(position() - positionsZiel);
        double bildAbstand = mitFrame && Double.isFinite(letzteBildZeit)
            ? Math.abs(letzteBildZeit - befehl.frameZiel) : Double.POSITIVE_INFINITY;
        double abstand = mitFrame ? bildAbstand : positionsAbstand;
        boolean ungenau = mitFrame
            ? !genauerFramePasst(position(), positionsZiel, letzteBildZeit, befehl.frameZiel,
                letzteBildRate, letzteBildFolge, befehl.erwarteteBildFolge)
            : positionsAbstand > SEEK_TOLERANZ_S;

        // Die Zeit einer erkannten TS-VOD ist nur dann geraeteuebergreifend exakt, wenn sie auf
        // den wirklichen Zeitstempel ihres ersten Segments zurueckgefuehrt wurde. Scheitert dieser
        // Preflight, darf die Wiedergabe weiterlaufen, bestaetigt der Runde aber keine falsche
        // Frame-Bereitschaft. Andere HLS-Arten behalten aus Kompatibilitaet den Standardpfad.
        if (befehl.urteil.optBoolean("genau") && hlsZeit != null
            && hlsZeit.exaktBlockiert()) {
            if (!befehl.ungenauGemeldet) {
                befehl.ungenauGemeldet = true;
                frameDiagnose("hls-anchor-unavailable", befehl, abstand);
            }
            wartenderBefehl = null;
            gemeinsamerStartOffen = false;
            spielenZeichnen();
            return;
        }

        /*
         * Nachmessen, wo der Sprung wirklich gelandet ist.
         *
         * <p>{@code seekTo} ist keine Zuweisung, sondern der Anfang eines
         * Suchvorgangs - wo er endet, steht erst hinterher fest. Bei einer Pause
         * schauen alle auf dasselbe Standbild, und da zaehlt der Bruchteil:
         * eine grobe Toleranz von anderthalb Sekunden reicht dafuer nicht. Drei
         * begrenzte Versuche verhindern sowohl ein falsches "bereit" als auch
         * eine endlose Suchschleife.
         */
        if (befehl.urteil.optBoolean("genau") && !befehl.urteil.optBoolean("nichtSpringen")
            && ungenau) {
            // Eine Bereitmeldung darf erst nach einem wirklich sitzenden Seek
            // hinaus. Bis zur Frist wird hoechstens dreimal nachgesetzt; bleibt
            // der Player ungenau, laeuft der Server in seinen sicheren Timeout
            // und startet niemanden allein.
            if (SystemClock.uptimeMillis() <= befehl.genauBis && befehl.sprungVersuche < 3) {
                befehl.sprungVersuche += 1;
                long zielMs = befehlSeekMillis(befehl);
                erwartetSeek = zielMs / 1000.0;
                erwartetBis = SystemClock.uptimeMillis() + 2000;
                befehl.erwarteteBildFolge = bildFolgeNachSeek(letzteBildFolge,
                    position(), zielMs / 1000.0, letzteBildZeit, befehl.frameZiel, letzteBildRate);
                frameDiagnose("inaccurate-retry", befehl, abstand);
                player.seekTo(zielMs);
                handler.postDelayed(this::befehlPruefen, 100);
            } else if (!befehl.ungenauGemeldet) {
                befehl.ungenauGemeldet = true;
                frameDiagnose("inaccurate-timeout", befehl, abstand);
            }
            return;
        }
        if (!befehl.urteil.optBoolean("nichtSpringen") && abstand > 1.5) return;

        JSONObject ereignis = befehl.urteil.optJSONObject("ereignis");
        boolean play = !befehl.urteil.optBoolean("warten") && ereignis != null && ereignis.optBoolean("playing");
        /*
         * Der gemeinsame Start.
         *
         * Bis hierher steht das Bild auf der verabredeten Stelle und der
         * Puffer ist gefuellt - beides gehoerte in die Spanne, die der Vorlauf
         * bereitstellt. Wer frueher fertig ist, wartet den Rest ab, statt zu
         * frueh loszufahren; wer laenger gebraucht hat, bekommt die
         * Verspaetung an der Stelle gutgeschrieben, weil ein Rueckstand sonst
         * fuer den Rest der Folge stehenbleibt (die Notbremse greift erst bei
         * fuenf Sekunden).
         */
        if (play && befehl.startBei > 0) {
            long rest = befehl.startBei - SystemClock.uptimeMillis();
            if (rest > 4) { handler.postDelayed(this::befehlPruefen, rest); return; }
            double zuspaet = (SystemClock.uptimeMillis() - befehl.startBei) / 1000.0;
            if (zuspaet > 0.15) {
                double nach = befehl.ziel + zuspaet * tempo;
                if (dauer() > 0) nach = Math.min(nach, Math.max(0, dauer() - 0.1));
                befehl.ziel = nach;
                befehl.frameZiel = Double.NaN;
                erwartetSeek = nach;
                player.seekTo(Math.round(nach * 1000));
            }
        }
        erwartetBis = SystemClock.uptimeMillis() + 2000;
        erwartetPlay = play;
        wartenderBefehl = null;
        if (play) gemeinsamerStartOffen = false;
        player.setPlayWhenReady(play);
        spielenZeichnen();
        frameDiagnose("complete", befehl, abstand);
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
        /*
         * Eine Zeile je Stufe - nicht je Variante.
         *
         * Eine HLS-Playlist fuehrt dieselbe Hoehe oft mehrfach: einmal je
         * Bitrate, je Codec, je Tonspur-Verbindung. ExoPlayer macht daraus
         * ebenso viele Spuren, und in der Liste stand dann viermal "1080p",
         * dreimal "720p" - Zeilen, die sich nicht unterscheiden lassen und
         * zwischen denen niemand waehlen kann. Uebrig bleibt je Hoehe die mit
         * der hoechsten Bitrate, und die Liste laeuft von oben nach unten.
         *
         * Zwei Stufen mit gleicher Hoehe und *unterschiedlicher* Bitrate sind
         * damit auf eine zusammengefasst. Das ist Absicht: die zweite ist die
         * schlechtere Fassung desselben Bildes.
         */
        java.util.LinkedHashMap<String, Integer> gesehen = new java.util.LinkedHashMap<>();
        ArrayList<Integer> hoehen = new ArrayList<>();
        ArrayList<Integer> raten = new ArrayList<>();
        for (Tracks.Group gruppe : player.getCurrentTracks().getGroups()) {
            if (gruppe.getType() != typ) continue;
            for (int i = 0; i < gruppe.length; i++) {
                if (!gruppe.isTrackSupported(i)) continue;
                Format format = gruppe.getTrackFormat(i);
                boolean gewaehlt = gruppe.isTrackSelected(i);
                if (typ != C.TRACK_TYPE_VIDEO) {
                    String text = format.label != null ? format.label
                        : format.language != null ? format.language : "Spur " + (i + 1);
                    if (gewaehlt) laufend = namen.size();
                    namen.add(text);
                    auswahl.add(new TrackSelectionOverride(gruppe.getMediaTrackGroup(), i));
                    continue;
                }
                int hoehe = format.height;
                int rate = format.bitrate > 0 ? format.bitrate : format.averageBitrate;
                String stufe = hoehe > 0 ? hoehe + "p"
                    : rate > 0 ? Math.round(rate / 1000f) + " kbit/s" : "Spur " + (i + 1);
                Integer schon = gesehen.get(stufe);
                if (schon == null) {
                    gesehen.put(stufe, namen.size());
                    hoehen.add(hoehe);
                    raten.add(rate);
                    if (gewaehlt) laufend = namen.size();
                    namen.add(stufe);
                    auswahl.add(new TrackSelectionOverride(gruppe.getMediaTrackGroup(), i));
                    continue;
                }
                // Dieselbe Hoehe schon da: die hoehere Bitrate gewinnt, und die
                // laufende Spur gewinnt immer - sonst zeigte die Liste auf eine
                // Zeile, die gar nicht spielt.
                boolean besser = rate > raten.get(schon - 1);
                if (gewaehlt) laufend = schon;
                if (!gewaehlt && !besser) continue;
                raten.set(schon - 1, Math.max(rate, raten.get(schon - 1)));
                auswahl.set(schon, new TrackSelectionOverride(gruppe.getMediaTrackGroup(), i));
            }
        }
        // Die hoechste Stufe zuerst - die Liste liest sich von "am besten" nach
        // "am sparsamsten", und "Automatisch" bleibt oben.
        if (typ == C.TRACK_TYPE_VIDEO && hoehen.size() > 1) {
            Integer[] reihe = new Integer[hoehen.size()];
            for (int i = 0; i < reihe.length; i++) reihe[i] = i;
            java.util.Arrays.sort(reihe, (links, rechts) -> hoehen.get(rechts) - hoehen.get(links));
            ArrayList<String> sortierteNamen = new ArrayList<>();
            ArrayList<TrackSelectionOverride> sortierteAuswahl = new ArrayList<>();
            sortierteNamen.add(namen.get(0));
            sortierteAuswahl.add(null);
            int neuLaufend = laufend == 0 ? 0 : -1;
            for (int i = 0; i < reihe.length; i++) {
                int alt = reihe[i] + 1;
                if (alt == laufend) neuLaufend = sortierteNamen.size();
                sortierteNamen.add(namen.get(alt));
                sortierteAuswahl.add(auswahl.get(alt));
            }
            namen = sortierteNamen;
            auswahl = sortierteAuswahl;
            laufend = Math.max(0, neuLaufend);
        }
        final ExoPlayer lauf = player;
        final List<TrackSelectionOverride> gewaehlt = auswahl;
        for (int i = 0; i < namen.size(); i++) {
            final int index = i;
            aktionen.add(() -> {
                if (player != lauf) return;
                androidx.media3.common.TrackSelectionParameters.Builder params = lauf.getTrackSelectionParameters()
                    .buildUpon().clearOverridesOfType(typ).setTrackTypeDisabled(typ, typ == C.TRACK_TYPE_TEXT && index == 0);
                if (gewaehlt.get(index) != null) params.setOverrideForType(gewaehlt.get(index));
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

        if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            if (runter) spielenUmschalten();
            return true;
        }
        if (code == KeyEvent.KEYCODE_MEDIA_PLAY) {
            if (runter) { abspielenAnfordern(); regung(); }
            return true;
        }
        if (code == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (runter) pauseAnfordern();
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
        if (code == KeyEvent.KEYCODE_MEDIA_NEXT || code == KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD) {
            if (runter && hatNaechste) umgebung.naechste();
            return true;
        }
        // Aufhoeren heisst hier zumachen. Ein Player, der auf STOP nur anhaelt,
        // laesst den Zuschauer vor einem stehenden Bild sitzen - und die
        // Fernbedienung des Fernsehers hat keinen zweiten Knopf dafuer.
        if (code == KeyEvent.KEYCODE_MEDIA_STOP || code == KeyEvent.KEYCODE_MEDIA_CLOSE) {
            if (runter) umgebung.schliessen();
            return true;
        }
        // Der Untertitelknopf der Fernbedienung. Ohne ihn muss man sich durch
        // die halbe Leiste steuern, um eine Spur an- oder abzuschalten.
        if (code == KeyEvent.KEYCODE_CAPTIONS) {
            if (runter) spuren(C.TRACK_TYPE_TEXT, "Untertitel");
            return true;
        }
        if (code == KeyEvent.KEYCODE_MENU || code == KeyEvent.KEYCODE_INFO
            || code == KeyEvent.KEYCODE_GUIDE) {
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
                int weite = sprungFaktor(event);
                if (code == KeyEvent.KEYCODE_DPAD_LEFT) springen(-10 * weite);
                else if (code == KeyEvent.KEYCODE_DPAD_RIGHT) springen(30 * weite);
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

    /**
     * Gedrueckt halten spult weiter.
     *
     * <p>Eine Fernbedienung hat keinen Regler. Wer eine Dreiviertelstunde
     * vorspulen will, drueckt sonst hundertmal - und jeder einzelne Druck ist
     * ein eigener Sprung, den der Player puffern muss. Der Faktor waechst mit
     * der Haltedauer: die ersten Druecke bleiben fein (10 bzw. 30 Sekunden),
     * ab einer halben Sekunde geht es in Minuten, ab anderthalb in Schritten
     * von drei bis fuenf.
     */
    private static int sprungFaktor(KeyEvent event) {
        int gehalten = event.getRepeatCount();
        if (gehalten >= 12) return 6;
        if (gehalten >= 5) return 3;
        return 1;
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
        letzteBildZeit = Double.NaN;
        letzteBildRate = Double.NaN;
        letzteBildFreigabeNs = Long.MIN_VALUE;
        hlsZeit = null;
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
