package local.elflix.android;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ArgbEvaluator;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewPropertyAnimator;
import android.view.animation.Interpolator;
import android.view.animation.LinearInterpolator;
import android.view.animation.PathInterpolator;

/**
 * Die Bewegungen der Oberflaeche - an einer Stelle, damit sie sich gleich
 * anfuehlen und sich gemeinsam abschalten lassen.
 *
 * <p><b>Was hier steht, ist Gestaltung, keine Verdeckung.</b> Eine Animation
 * kann ein Zucken verbergen, aber sie beseitigt es nicht - sie macht es nur
 * langsamer. Alles hier setzt deshalb voraus, dass die Stelle darunter schon
 * ruhig ist: eine Reihe, die sich beim Auffrischen ohnehin neu baut, wird durch
 * einen Auftritt nicht besser, sondern zweimal auffaellig. Die Regel dazu steht
 * bei {@link #auftrittEinmal}: jede Ansicht bekommt ihren Auftritt genau
 * einmal, und ein Neuzeichnen wiederholt ihn nicht.
 *
 * <p><b>Wer die Bewegung abgeschaltet hat, bekommt keine.</b> Android hat kein
 * {@code prefers-reduced-motion} wie eine Webseite; es hat die Entwickler- und
 * Bedienungshilfeeinstellung "Animationen entfernen" und, darauf aufbauend,
 * {@link ValueAnimator#areAnimatorsEnabled()}. Steht sie auf aus, gibt
 * {@link #dauer} eine Null zurueck, und jede Stelle hier prueft darauf und
 * setzt den Endzustand sofort. Kein Ort in der App darf eine feste Dauer
 * verwenden.
 *
 * <p><b>Was bewegt wird.</b> Fast ausschliesslich {@code alpha}, {@code scale}
 * und {@code translation} - die drei Eigenschaften, die die Grafikeinheit ohne
 * neues Messen und Zeichnen umsetzt. Kein Weg hier aendert eine Groesse im
 * Layout, mit zwei erklaerten Ausnahmen: {@link #ausblendenUndZusammenziehen}
 * und {@link #klappen}, wo die wandernde Hoehe genau der Punkt ist. Wo laenger
 * als ein Wimpernschlag skaliert oder verschoben wird, kommt {@code withLayer()}
 * dazu; die Ansicht wird dann einmal in eine Textur gezeichnet und nur noch
 * verschoben.
 */
public final class Bewegung {
    /** Druck- und Fokusreaktionen: gerade eben spuerbar. */
    public static final long KURZ = 150L;
    /** Einblenden, Ausblenden, Uebergaenge. Die Mitte des geforderten Fensters. */
    public static final long MITTEL = 200L;
    /** Zusammenziehen beim Loeschen - der laengste Weg, den etwas hier geht. */
    public static final long LANG = 250L;
    /** Der Auftritt einer Reihe oder eines Abschnitts beim ersten Erscheinen. */
    public static final long AUFTRITT = 300L;
    /** Ein Seitenwechsel. Innerhalb des geforderten Fensters von 200-350 ms. */
    public static final long SEITE = 280L;
    /** Der Fokuswechsel am Fernseher - innerhalb der geforderten 150-220 ms. */
    public static final long FOKUS = 190L;

    /** Der Abstand zweier Auftritte in einer Staffel. */
    public static final long STAFFEL = 38L;
    /** So viele Elemente werden gestaffelt; danach kommt alles gemeinsam. */
    private static final int STAFFEL_MAX = 8;

    /**
     * Die Marke, an der eine Ansicht ihren Auftritt schon hinter sich hat.
     *
     * <p>Sie ist die Antwort auf "Animationen duerfen nicht bei jedem Render
     * neu starten": {@link #auftrittEinmal} setzt sie, und ein zweiter Aufruf
     * auf derselben Ansicht tut nichts mehr.
     */
    private static final int MARKE_AUFTRITT = R.id.elfix_auftritt;

    /**
     * Ob eine frisch gebaute Seite ihre Auftritte bekommt.
     *
     * <p><b>Das Tor gegen "Animationen starten bei jedem Render neu".</b> Eine
     * Seite wird in dieser App aus zwei Gruenden gebaut: weil jemand dorthin
     * navigiert hat, und weil sich im Hintergrund eine Zahl geruehrt hat -
     * eine Empfehlungsreihe wird fertig, der Geraeteabgleich meldet sich, ein
     * Schalter wurde umgelegt. Der erste Fall ist ein Auftritt. Der zweite ist
     * keiner: wer gerade liest, will nicht, dass ihm die halbe Seite noch
     * einmal entgegenfaellt.
     *
     * <p>Gelesen wird das Tor <em>beim Bauen</em>, nicht beim Animieren. Die
     * Staffel einer Reihe laeuft erst nach dem Vermessen los, und bis dahin
     * steht das Tor laengst wieder anders - deshalb entscheidet jede Stelle
     * beim Anlegen der Ansicht, ob sie ueberhaupt eine Bewegung anmeldet.
     */
    private static boolean auftritteFrei = true;

    /**
     * Wie viel Verzoegerung der naechste Abschnitt bekommt.
     *
     * <p>Eine Seite baut sich von oben nach unten auf, und jeder Abschnitt
     * bekommt seine Stelle in der Reihe, sobald er angelegt wird. Der Zaehler
     * laeuft deshalb in Baureihenfolge und nicht in Bildschirmreihenfolge -
     * beides ist dasselbe, solange eine Seite von oben nach unten gebaut wird,
     * und das tut jede hier.
     */
    private static long versatz = 0L;

    /** Der Zaehler faengt von vorn an - beim Anlegen einer neuen Seite. */
    public static void versatzZuruecksetzen() {
        versatz = 0L;
    }

    /**
     * Die naechste Stelle in der Staffel - und weiterzaehlen.
     *
     * <p>Gedeckelt bei einer knappen halben Sekunde: was danach kaeme, steht
     * ohnehin unterhalb des Bildschirms, und niemand wartet gern darauf, dass
     * eine Seite fertig wird, die er laengst sieht.
     */
    public static long naechsterVersatz() {
        long jetzt = Math.min(versatz, 8 * 55L);
        versatz += 55L;
        return jetzt;
    }

    /** Das Tor stellen - siehe {@link #auftritteFrei()}. */
    public static void auftritteFreigeben(boolean frei) {
        auftritteFrei = frei;
    }

    /** Ob die Seite, die gerade gebaut wird, Auftritte bekommen darf. */
    public static boolean auftritteFrei() {
        return auftritteFrei;
    }

    private Bewegung() {
    }

    /* --------------------------------------------------------- Die Kurven */

    /**
     * Die uebliche Kurve: schnell los, weich aus. Sie ist der Grund, warum
     * zweihundert Millisekunden nach zweihundert Millisekunden aussehen und
     * nicht nach einer halben Sekunde.
     */
    public static Interpolator kurve() {
        return new PathInterpolator(0.2f, 0f, 0f, 1f);
    }

    /** Fuer Dinge, die hereinkommen: sehr schnell los, sehr weich aus. */
    public static Interpolator hinein() {
        return new PathInterpolator(0.05f, 0.7f, 0.1f, 1f);
    }

    /** Fuer Dinge, die gehen: langsam los, schnell weg. Das Gegenstueck. */
    public static Interpolator hinaus() {
        return new PathInterpolator(0.4f, 0f, 1f, 1f);
    }

    /**
     * Eine gedaempfte Feder - der Ueberschwinger.
     *
     * <p>Warum selbstgebaut und keine Bibliothek: eine Feder ist eine Zeile
     * Mathematik, und {@code androidx.dynamicanimation} waere eine
     * Abhaengigkeit mehr fuer eine abklingende Schwingung. Die Formel ist die
     * gedaempfte Kosinusschwingung; bei {@code t >= 1} steht sie auf genau 1,
     * sonst bliebe am Ende ein Sprung stehen.
     *
     * @param schwung wie weit ueber das Ziel hinaus - 0.3 ist kaum zu sehen,
     *                1.0 wippt deutlich
     */
    public static Interpolator feder(final float schwung) {
        final float faktor = Math.max(0.05f, schwung);
        return new Interpolator() {
            @Override
            public float getInterpolation(float t) {
                if (t >= 1f) return 1f;
                double abklingen = Math.exp(-6.0 * t);
                double schwingung = Math.cos(faktor * 9.0 * t);
                return (float) (1.0 - abklingen * schwingung);
            }
        };
    }

    /** Die uebliche Feder: sichtbar, aber nicht albern. */
    public static Interpolator feder() {
        return feder(0.55f);
    }

    /* -------------------------------------------------- Darf es sich regen */

    /**
     * Wie lange etwas dauern darf - null, wenn das Geraet keine Animationen
     * will.
     */
    public static long dauer(Context context, long gewuenscht) {
        if (context == null) return 0L;
        try {
            if (!ValueAnimator.areAnimatorsEnabled()) return 0L;
        } catch (Exception fehler) {
            // Eine Auskunft, die nicht zu bekommen ist, wird als "aus"
            // gelesen: lieber keine Bewegung als eine, die niemand wollte.
            return 0L;
        }
        return gewuenscht;
    }

    /** Ob sich ueberhaupt etwas bewegen darf. */
    public static boolean an(Context context) {
        return dauer(context, MITTEL) > 0L;
    }

    /**
     * Ob grosse Wege erlaubt sind - Zoom, Parallaxe, weite Schuebe.
     *
     * <p>Heute dasselbe wie {@link #an}: Android kennt nur "Animationen an" und
     * "Animationen aus", keine Zwischenstufe wie {@code prefers-reduced-motion:
     * reduce}. Die Frage steht trotzdem an jeder Stelle, an der ein grosser Weg
     * gegangen wird - so greift eine spaetere Zwischenstufe genau dort und
     * nimmt die kurzen Blenden nicht mit.
     */
    public static boolean weiteWege(Context context) {
        return an(context);
    }

    /**
     * Ob das Geraet mit seinen Mitteln haushalten muss.
     *
     * <p>Ein Fernsehstick hat 1,7 GB fuer alles und rechnet mit 32 Bit. Was
     * auf einem Telefon nicht auffaellt, ist dort die Halbe Miete. Einmal
     * gefragt und gemerkt - die Antwort aendert sich nicht.
     */
    private static Boolean sparsamGemerkt;

    public static boolean sparsam(Context context) {
        if (sparsamGemerkt != null) return sparsamGemerkt;
        if (context == null) return false;
        boolean klein = false;
        try {
            android.app.ActivityManager verwalter = (android.app.ActivityManager)
                context.getApplicationContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (verwalter != null) {
                android.app.ActivityManager.MemoryInfo lage =
                    new android.app.ActivityManager.MemoryInfo();
                verwalter.getMemoryInfo(lage);
                klein = verwalter.isLowRamDevice() || lage.totalMem / (1024 * 1024) < 2048;
            }
        } catch (Exception fehler) {
            // Keine Auskunft heisst: nicht sparsam. Eine Einschraenkung, die
            // man nicht begruenden kann, ist keine.
            klein = false;
        }
        sparsamGemerkt = klein;
        return klein;
    }

    private static float dp(View ansicht, float wert) {
        return ansicht.getResources().getDisplayMetrics().density * wert;
    }

    /** Alles zuruecksetzen, was hier je verstellt wird. */
    public static void endzustand(View ansicht) {
        if (ansicht == null) return;
        ansicht.animate().cancel();
        ansicht.setAlpha(1f);
        ansicht.setScaleX(1f);
        ansicht.setScaleY(1f);
        ansicht.setTranslationX(0f);
        ansicht.setTranslationY(0f);
    }

    /* ------------------------------------------------------- Die Auftritte */

    /**
     * Der Auftritt einer Ansicht: von unten herein, dabei von 0.94 auf 1 und
     * aus der Blende.
     *
     * <p>Das ist die Grundbewegung der ganzen App - Kacheln, Reihen,
     * Abschnitte, Suchtreffer. Drei Eigenschaften gleichzeitig, keine davon
     * kostet eine neue Messung.
     *
     * @param verzoegerung fuer die Staffel; 0 heisst sofort
     */
    public static void auftritt(View ansicht, long verzoegerung) {
        auftritt(ansicht, verzoegerung, 0.94f, 18f);
    }

    /**
     * Derselbe Auftritt, aber mit eigenem Mass.
     *
     * @param abVon   Anfangsgroesse, 1 laesst das Skalieren weg
     * @param abUnten Weg von unten in dp
     */
    public static void auftritt(View ansicht, long verzoegerung, float abVon, float abUnten) {
        if (ansicht == null) return;
        long dauer = dauer(ansicht.getContext(), AUFTRITT);
        if (dauer <= 0) {
            endzustand(ansicht);
            return;
        }
        boolean weit = weiteWege(ansicht.getContext());
        ansicht.setAlpha(0f);
        ansicht.setScaleX(weit ? abVon : 1f);
        ansicht.setScaleY(weit ? abVon : 1f);
        ansicht.setTranslationY(weit ? dp(ansicht, abUnten) : 0f);
        ViewPropertyAnimator lauf = ansicht.animate()
            .alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
            .setStartDelay(verzoegerung)
            .setDuration(dauer)
            .setInterpolator(hinein());
        if (weit) lauf.withLayer();
        lauf.start();
    }

    /**
     * Der Auftritt, aber garantiert nur einmal je Ansicht.
     *
     * <p><b>Der wichtigste Weg hier.</b> Eine Reihe wird beim Auffrischen neu
     * gezeichnet, und ohne diese Marke fiele jede Kachel bei jedem Zaehlerlauf
     * wieder von unten herein. Die Marke haengt an der Ansicht, nicht an der
     * Stelle: eine Kachel, die stehen bleibt, behaelt sie; eine, die wirklich
     * neu entsteht, hat sie nicht.
     */
    public static void auftrittEinmal(View ansicht, long verzoegerung) {
        if (ansicht == null) return;
        if (ansicht.getTag(MARKE_AUFTRITT) != null) return;
        if (!auftritteFrei) {
            // Ein stiller Neuaufbau. Die Marke wird trotzdem gesetzt: sonst
            // holte die Ansicht ihren Auftritt beim naechsten Anlass nach, und
            // der Anlass waere wieder keiner.
            ansicht.setTag(MARKE_AUFTRITT, Boolean.TRUE);
            endzustand(ansicht);
            return;
        }
        ansicht.setTag(MARKE_AUFTRITT, Boolean.TRUE);
        auftritt(ansicht, verzoegerung);
    }

    /** Diese Ansicht hat ihren Auftritt hinter sich - ohne dass er lief. */
    public static void auftrittVerbrauchen(View ansicht) {
        if (ansicht == null) return;
        ansicht.setTag(MARKE_AUFTRITT, Boolean.TRUE);
    }

    /**
     * Eine Ansicht, die neu dazugekommen ist, sanft aufkommen lassen.
     *
     * <p>Die kleine Schwester des Auftritts: nur Deckkraft und ein kurzer Weg.
     * Fuer Stellen, an denen etwas nachgereicht wird, ohne dass eine ganze
     * Seite neu dasteht.
     */
    public static void einblenden(View ansicht) {
        if (ansicht == null) return;
        long dauer = dauer(ansicht.getContext(), MITTEL);
        if (dauer <= 0) {
            ansicht.setAlpha(1f);
            ansicht.setTranslationY(0f);
            return;
        }
        ansicht.setAlpha(0f);
        ansicht.setTranslationY(dp(ansicht, 8f));
        ansicht.animate().alpha(1f).translationY(0f)
            .setDuration(dauer).setInterpolator(kurve()).start();
    }

    /**
     * Die Kinder einer Gruppe nacheinander auftreten lassen.
     *
     * <p>Der Stagger. Er ist der Unterschied zwischen "die Seite ist da" und
     * "die Seite baut sich auf": acht Kacheln gleichzeitig sind ein Blitz, acht
     * Kacheln im Abstand von knapp vier Hundertstel sind eine Bewegung. Ab der
     * neunten laeuft alles gemeinsam - laenger wartet niemand gern, und was so
     * weit hinten steht, ist ohnehin nicht im Bild.
     *
     * @param ab wie viel Verzoegerung die ganze Staffel zusaetzlich bekommt
     */
    public static void staffeln(ViewGroup gruppe, long ab) {
        if (gruppe == null) return;
        for (int i = 0; i < gruppe.getChildCount(); i += 1) {
            long versatz = ab + STAFFEL * Math.min(i, STAFFEL_MAX);
            auftrittEinmal(gruppe.getChildAt(i), versatz);
        }
    }

    /**
     * Dieselbe Staffel, aber nur fuer das, was im Bild steht.
     *
     * <p>Gefordert war ausdruecklich "nur sichtbare Elemente animieren". Eine
     * Reihe schiebt zwanzig Kacheln nebeneinander, von denen drei zu sehen
     * sind; die uebrigen siebzehn wuerden gegen eine Wand animieren, die
     * niemand ansieht, und bis der Daumen dort ankommt, ist die Bewegung
     * laengst vorbei. Sie bekommen ihren Endzustand sofort - und ihre Marke,
     * damit sie beim Hereinscrollen nicht doch noch anfangen zu tanzen.
     *
     * @param sichtbarBis rechte Kante des sichtbaren Bereichs in Pixeln
     */
    public static void staffelnWaagerecht(ViewGroup reihe, int sichtbarBis, long ab) {
        if (reihe == null) return;
        int gezeigt = 0;
        for (int i = 0; i < reihe.getChildCount(); i += 1) {
            View kind = reihe.getChildAt(i);
            if (kind.getLeft() >= sichtbarBis) {
                auftrittVerbrauchen(kind);
                endzustand(kind);
                continue;
            }
            auftrittEinmal(kind, ab + STAFFEL * Math.min(gezeigt, STAFFEL_MAX));
            gezeigt += 1;
        }
    }

    /**
     * Eine Kachel gehen lassen: hochskalieren, ein Stueck zur Seite, blass
     * werden - und dabei zusammenziehen, damit die Liste nicht ins Loch
     * springt.
     *
     * <p>Das Zusammenziehen ist der Punkt. Nur auszublenden hinterliesse ein
     * Loch, in das die Liste anschliessend hineinspringt - und genau dieses
     * Springen war die Meldung. Die Hoehe laeuft deshalb mit der Deckkraft
     * gegen null, und der Nachbar rueckt waehrenddessen nach statt danach.
     *
     * <p>Der kleine Sprung nach vorn und zur Seite kommt aus der Forderung
     * "leicht hochskalieren, Fade-Out, kleiner horizontaler Move" - er macht
     * aus dem Verschwinden eine Geste statt eines Ausfalls.
     *
     * @param danach laeuft, wenn nichts mehr zu sehen ist - dort gehoert das
     *               wirkliche Loeschen hin
     */
    public static void ausblendenUndZusammenziehen(View ansicht, Runnable danach) {
        if (ansicht == null) {
            if (danach != null) danach.run();
            return;
        }
        long dauer = dauer(ansicht.getContext(), LANG);
        int hoehe = ansicht.getHeight();
        if (dauer <= 0 || hoehe <= 0) {
            if (danach != null) danach.run();
            return;
        }
        if (weiteWege(ansicht.getContext())) {
            ansicht.animate().scaleX(1.06f).scaleY(1.06f)
                .translationX(dp(ansicht, 14f))
                .setDuration(dauer).setInterpolator(hinaus()).withLayer().start();
        }
        final ViewGroup.LayoutParams masse = ansicht.getLayoutParams();
        final int alteHoehe = hoehe;
        ValueAnimator lauf = ValueAnimator.ofFloat(1f, 0f);
        lauf.setDuration(dauer);
        lauf.setInterpolator(kurve());
        lauf.addUpdateListener(schritt -> {
            float anteil = (float) schritt.getAnimatedValue();
            ansicht.setAlpha(anteil);
            if (masse != null) {
                masse.height = Math.max(1, Math.round(alteHoehe * anteil));
                ansicht.setLayoutParams(masse);
            }
        });
        lauf.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator wer) {
                // Die Masse zurueckstellen: die Ansicht kann aus einem Pool
                // kommen und stuende sonst beim naechsten Mal einen Pixel hoch
                // da.
                if (masse != null) {
                    masse.height = alteHoehe;
                    ansicht.setLayoutParams(masse);
                }
                endzustand(ansicht);
                if (danach != null) danach.run();
            }
        });
        lauf.start();
    }

    /**
     * Etwas kommt dazu und soll auffallen: ein kurzer Ueberschwinger.
     *
     * <p>Das Gegenstueck zum Verschwinden. Gefordert als "Card poppt subtil
     * rein" - subtil heisst hier 0.86 als Startgroesse und eine Feder, die
     * einmal knapp ueber die Eins geht.
     */
    public static void hereinPoppen(View ansicht) {
        if (ansicht == null) return;
        long dauer = dauer(ansicht.getContext(), AUFTRITT);
        if (dauer <= 0 || !weiteWege(ansicht.getContext())) {
            endzustand(ansicht);
            return;
        }
        ansicht.setAlpha(0f);
        ansicht.setScaleX(0.86f);
        ansicht.setScaleY(0.86f);
        ansicht.animate().alpha(1f).scaleX(1f).scaleY(1f)
            .setDuration(dauer).setInterpolator(feder(0.7f)).withLayer().start();
    }

    /* ---------------------------------------------------- Druck und Fokus */

    /**
     * Der Daumen drueckt: die Flaeche gibt nach und federt zurueck.
     *
     * <p>Hinunter kurz und beschleunigend - der Druck soll sofort quittiert
     * sein; herauf mit Feder, weil erst der Ueberschwinger aus dem Nachgeben
     * ein Zurueckschnellen macht. Ohne ihn fuehlt sich ein Knopf an wie ein
     * Bild von einem Knopf.
     *
     * @param tiefe wie weit nachgegeben wird; 0.95 fuer grosse Knoepfe, 0.985
     *              fuer ganze Karten, die sonst wackeln
     */
    public static void druck(View ansicht, boolean gedrueckt, float tiefe) {
        if (ansicht == null) return;
        float ziel = gedrueckt ? tiefe : 1f;
        long dauer = dauer(ansicht.getContext(), gedrueckt ? 80L : LANG);
        if (dauer <= 0) {
            ansicht.animate().cancel();
            ansicht.setScaleX(ziel);
            ansicht.setScaleY(ziel);
            return;
        }
        ansicht.animate().scaleX(ziel).scaleY(ziel)
            .setDuration(dauer)
            .setInterpolator(gedrueckt ? hinaus() : feder(0.5f))
            .start();
    }

    /**
     * Der Fokus am Fernseher: die Karte kommt nach vorn.
     *
     * <p>Drei Dinge gleichzeitig, und das ist Absicht. Die Groesse sagt "hier
     * bist du", die Hoehe ueber der Flaeche wirft den Schatten, der die Karte
     * aus der Reihe hebt, und die Feder nimmt dem Ganzen das Mechanische. Der
     * Wechsel selbst braucht nichts weiter: die alte Karte laeuft mit
     * derselben Dauer zurueck, waehrend die neue waechst - beide Wege laufen
     * gleichzeitig, es gibt keinen Sprung dazwischen.
     *
     * @param gross Zielgroesse im Fokus, ueblich 1.10
     * @param hoehe Schattenhoehe in dp im Fokus
     */
    public static void fokus(View ansicht, boolean hat, float gross, float hoehe) {
        if (ansicht == null) return;
        // Eine Karte, die mitten im Auftritt den Fokus bekommt, muss ihn
        // abbrechen duerfen. Der Auftritt bewegt Deckkraft, Weg *und* Groesse
        // in einem einzigen Lauf; wuerde der Fokus nur die Groesse anfassen,
        // risse er den ganzen Lauf ab und die Karte bliebe unsichtbar stehen.
        // Also: erst den Auftritt auf sein Ende setzen, dann den Fokus.
        if (ansicht.getAlpha() < 1f || ansicht.getTranslationY() != 0f) {
            ansicht.animate().cancel();
            ansicht.setAlpha(1f);
            ansicht.setTranslationY(0f);
        }
        float ziel = hat ? gross : 1f;
        float schatten = hat ? dp(ansicht, hoehe) : 0f;
        long dauer = dauer(ansicht.getContext(), FOKUS);
        if (dauer <= 0) {
            ansicht.animate().cancel();
            ansicht.setScaleX(ziel);
            ansicht.setScaleY(ziel);
            ansicht.setElevation(schatten);
            return;
        }
        ansicht.animate().scaleX(ziel).scaleY(ziel)
            .setDuration(dauer)
            // Nur der Weg hinein federt. Zurueck darf nichts ueberschwingen:
            // die Karte, die den Fokus abgibt, wippte sonst hinter der neuen
            // her, und im Blickfeld waeren zwei Bewegungen statt einer.
            .setInterpolator(hat ? feder(0.45f) : kurve())
            .withLayer()
            .start();
        ValueAnimator hebung = ValueAnimator.ofFloat(ansicht.getElevation(), schatten);
        hebung.setDuration(dauer);
        hebung.setInterpolator(kurve());
        hebung.addUpdateListener(s -> ansicht.setElevation((float) s.getAnimatedValue()));
        hebung.start();
    }

    /**
     * Die OK-Taste am Fernseher: kurz hinein, dann zurueck auf Fokusgroesse.
     *
     * <p>Ohne das ist ein Druck auf der Fernbedienung voellig unquittiert - man
     * sieht erst wieder etwas, wenn die naechste Seite steht, und bis dahin
     * weiss niemand, ob der Knopf angekommen ist.
     */
    public static void tastendruck(final View ansicht, final float fokusGross) {
        if (ansicht == null) return;
        final long dauer = dauer(ansicht.getContext(), KURZ);
        if (dauer <= 0) return;
        ansicht.animate().cancel();
        ansicht.animate().scaleX(fokusGross * 0.94f).scaleY(fokusGross * 0.94f)
            .setDuration(dauer / 2).setInterpolator(hinaus())
            .withEndAction(() -> ansicht.animate()
                .scaleX(fokusGross).scaleY(fokusGross)
                .setDuration(dauer).setInterpolator(feder(0.6f)).start())
            .start();
    }

    /* ------------------------------------------------------- Uebergaenge */

    /**
     * Eine Farbe weich auf eine andere ziehen - auf einer Form.
     *
     * <p>Fuer den Schalter und die Reiter: ein Zustandswechsel, bei dem die
     * Farbe die Aussage traegt, darf nicht umspringen.
     */
    public static void farbwechsel(final GradientDrawable form, int von, int nach, long wunsch,
                                   Context context) {
        if (form == null) return;
        long dauer = dauer(context, wunsch);
        if (dauer <= 0) {
            form.setColor(nach);
            return;
        }
        ValueAnimator lauf = ValueAnimator.ofObject(new ArgbEvaluator(), von, nach);
        lauf.setDuration(dauer);
        lauf.setInterpolator(kurve());
        lauf.addUpdateListener(s -> form.setColor((Integer) s.getAnimatedValue()));
        lauf.start();
    }

    /**
     * Ein Bild wechseln, ohne dass es dazwischen leer ist.
     *
     * <p>Gefordert fuer den Titelhintergrund: das alte Bild soll abdunkeln und
     * wegzoomen, das neue etwas groesser anfangen und auf seine Groesse
     * zurueckgehen. Genau das steht hier - in zwei Haelften, damit dazwischen
     * das eigentliche Umhaengen passieren kann.
     *
     * @param dann was in der Mitte geschieht: dort gehoert der Bildwechsel hin
     */
    public static void bildTausch(final View bild, final Runnable dann) {
        bildTausch(bild, dann, null);
    }

    /**
     * Derselbe Wechsel, aber mit einem Wort am Ende.
     *
     * @param fertig laeuft, wenn die zweite Haelfte durch ist - dort gehoert
     *               hin, was das Bild danach wieder in Bewegung setzt
     */
    public static void bildTausch(final View bild, final Runnable dann, final Runnable fertig) {
        if (bild == null) {
            if (dann != null) dann.run();
            if (fertig != null) fertig.run();
            return;
        }
        final long dauer = dauer(bild.getContext(), MITTEL);
        if (dauer <= 0 || !weiteWege(bild.getContext())) {
            if (dann != null) dann.run();
            endzustand(bild);
            if (fertig != null) fertig.run();
            return;
        }
        bild.animate().alpha(0.25f).scaleX(1.06f).scaleY(1.06f)
            .setDuration(dauer).setInterpolator(hinaus()).withLayer()
            .withEndAction(() -> {
                if (dann != null) dann.run();
                // Das neue Bild faengt groesser an und geht auf seine Groesse
                // zurueck - dadurch wirkt der Wechsel wie eine Kamerafahrt und
                // nicht wie ein Austausch.
                bild.setScaleX(1.10f);
                bild.setScaleY(1.10f);
                bild.animate().alpha(1f).scaleX(1f).scaleY(1f)
                    .setDuration(dauer(bild.getContext(), LANG + 120L))
                    .setInterpolator(hinein())
                    .withLayer()
                    .withEndAction(() -> {
                        if (fertig != null) fertig.run();
                    })
                    .start();
            })
            .start();
    }

    /**
     * Den Inhalt eines Blocks wechseln, ohne dass die Schrift umspringt.
     *
     * <p>Der Block geht ein Stueck nach oben aus dem Bild und der neue kommt
     * von unten nach - dieselbe Richtung, in die man liest. Gefordert war
     * "Titel/Metadaten wechseln animiert, Buttons bewegen sich leicht mit";
     * beides ergibt sich von selbst, weil hier der ganze Block bewegt wird und
     * die Knoepfe darin stehen.
     *
     * @param dann der eigentliche Wechsel - er passiert im unsichtbaren
     *             Augenblick dazwischen
     */
    public static void inhaltTausch(final View block, final Runnable dann) {
        if (block == null) {
            if (dann != null) dann.run();
            return;
        }
        final long raus = dauer(block.getContext(), KURZ);
        if (raus <= 0 || !weiteWege(block.getContext())) {
            if (dann != null) dann.run();
            endzustand(block);
            return;
        }
        block.animate().alpha(0f).translationY(-dp(block, 10f))
            .setDuration(raus).setInterpolator(hinaus()).withLayer()
            .withEndAction(() -> {
                if (dann != null) dann.run();
                block.setTranslationY(dp(block, 16f));
                block.animate().alpha(1f).translationY(0f)
                    .setDuration(dauer(block.getContext(), AUFTRITT))
                    .setInterpolator(hinein()).withLayer().start();
            })
            .start();
    }

    /**
     * Der langsame Zoom auf einem stehenden Bild - Ken Burns.
     *
     * <p>Zwoelf Sekunden von 1.00 auf 1.06 und wieder zurueck, endlos. Der Weg
     * ist so klein, dass man ihn nicht als Bewegung liest, sondern als Tiefe;
     * genau deshalb ist er so lang. Er laeuft nur auf der Grafikeinheit: eine
     * Skalierung misst nichts neu.
     *
     * <p>Der Rueckgabewert ist der Lauf - wer das Bild wegraeumt, muss ihn
     * beenden, sonst haelt er die Ansicht fest.
     */
    public static ValueAnimator kenBurns(final View bild) {
        if (bild == null || !weiteWege(bild.getContext())) return null;
        // Auf kleinen Geraeten nicht.
        //
        // Der langsame Zoom ist die einzige Bewegung hier, die nie aufhoert -
        // und eine Ansicht, die sich bewegt, wird in jedem Bild neu
        // zusammengesetzt. Auf einem Fernsehstick heisst das: die Startseite
        // zeichnet dauernd, auch wenn niemand etwas tut. Gemessen am Fire TV
        // Stick (1,7 GB, 32 Bit): 1856 gezeichnete Bilder in zwanzig Sekunden
        // Blaettern, ein Drittel davon zu spaet. Alle uebrigen Bewegungen sind
        // kurz und haben einen Anlass; diese eine ist Zierde und faellt
        // deshalb als erste weg.
        if (sparsam(bild.getContext())) return null;
        ValueAnimator lauf = ValueAnimator.ofFloat(1f, 1.06f);
        lauf.setDuration(12000L);
        lauf.setRepeatCount(ValueAnimator.INFINITE);
        lauf.setRepeatMode(ValueAnimator.REVERSE);
        lauf.setInterpolator(new LinearInterpolator());
        lauf.addUpdateListener(s -> {
            float wert = (float) s.getAnimatedValue();
            bild.setScaleX(wert);
            bild.setScaleY(wert);
        });
        lauf.start();
        return lauf;
    }

    /**
     * Eine ganze Seite tritt auf.
     *
     * <p>Vorwaerts kommt sie von rechts, zurueck von links - der Weg ist die
     * Richtung, in die man geht. Er ist bewusst kurz (fuenf Prozent der
     * Breite): ein Seitenwechsel, den man als Reise wahrnimmt, ist zu langsam,
     * auch wenn die Zahl darunter dieselbe ist.
     */
    public static void seitenAuftritt(final View seite, final boolean rueckwaerts) {
        if (seite == null) return;
        final long dauer = dauer(seite.getContext(), SEITE);
        if (dauer <= 0 || !weiteWege(seite.getContext())) {
            endzustand(seite);
            return;
        }
        // Sichtbar ab dem ersten gezeichneten Bild - und nur der Weg wird
        // bewegt.
        //
        // <b>Der gemeldete Fehler.</b> Hier stand vorher
        // {@code seite.setAlpha(0f)} und dahinter ein {@code post(...)}, das
        // die Bewegung erst im naechsten Durchlauf des Hauptfadens anfing.
        // Zwischen beidem liegt mindestens ein gezeichnetes Bild, und in dem
        // steht die fertige Seite vollstaendig durchsichtig da: Kopf- und
        // Fussleiste bleiben stehen, die Mitte ist leer. Kommt der Hauptfaden
        // nicht sofort dazu - beim Aufbau einer Seite mit Bildern kommt er
        // das nie -, sind es mehrere Bilder. Gemeldet als "Zucken beim
        // Navigieren".
        //
        // Deckkraft ist deshalb aus dem Uebergang heraus. Was bleibt, ist ein
        // Weg von 24 dp; er braucht keine Breite und damit auch keine Messung,
        // also laesst er sich sofort setzen statt im naechsten Durchlauf.
        endzustand(seite);
        seite.setTranslationX(rueckwaerts ? -dp(seite, 24f) : dp(seite, 24f));
        seite.animate().translationX(0f)
            .setDuration(dauer).setInterpolator(hinein()).withLayer().start();
    }

    /**
     * Eine Detailseite tritt auf: sie waechst aus der Karte heraus, aus der sie
     * geoeffnet wurde.
     *
     * <p>Kein echtes Shared Element - dafuer muesste die alte Seite noch
     * stehen, und sie ist beim Aufbau der neuen laengst weg. Was bleibt, ist
     * der Eindruck: die Seite faengt bei 0.92 an und waechst auf ihre Groesse.
     * Das liest sich als Hineinzoomen und kostet nichts.
     */
    public static void zoomAuftritt(final View seite) {
        if (seite == null) return;
        long dauer = dauer(seite.getContext(), SEITE);
        if (dauer <= 0 || !weiteWege(seite.getContext())) {
            endzustand(seite);
            return;
        }
        // Auch hier ohne Deckkraft - aus demselben Grund wie bei
        // {@link #seitenAuftritt}: eine Seite, die bei 0 anfaengt, ist im
        // ersten gezeichneten Bild nicht da. Der Sprung von 0.92 auf 1 hat
        // dieselbe Aussage und ist von Anfang an zu sehen; er faengt etwas
        // spaeter an (0.96), weil ohne die Blende der Weg kuerzer wirken darf.
        endzustand(seite);
        seite.setScaleX(0.96f);
        seite.setScaleY(0.96f);
        seite.animate().scaleX(1f).scaleY(1f)
            .setDuration(dauer).setInterpolator(hinein()).withLayer().start();
    }

    /**
     * Ein Dialog geht auf: aus 0.93 herauf, ein Stueck von unten, mit Feder.
     *
     * <p>Android animiert Dialoge von sich aus, aber mit der Systemkurve und
     * ohne Ueberschwinger - dasselbe, was jede andere App zeigt. Hier wird
     * stattdessen der Inhalt des Fensters bewegt, sobald es steht.
     */
    public static void dialogAuftritt(final android.app.Dialog dialog) {
        if (dialog == null) return;
        dialog.setOnShowListener(wer -> {
            android.view.Window fenster = dialog.getWindow();
            if (fenster == null) return;
            View inhalt = fenster.getDecorView();
            long dauer = dauer(inhalt.getContext(), AUFTRITT);
            if (dauer <= 0) return;
            inhalt.setAlpha(0f);
            inhalt.setScaleX(0.93f);
            inhalt.setScaleY(0.93f);
            inhalt.setTranslationY(dp(inhalt, 20f));
            inhalt.animate().alpha(1f).scaleX(1f).scaleY(1f).translationY(0f)
                .setDuration(dauer).setInterpolator(feder(0.4f)).withLayer().start();
        });
    }

    /**
     * Ein kurzer Herzschlag - fuer das, was gerade laeuft.
     *
     * <p>Beim Countdown der naechsten Folge. Ein Puls, kein Dauerzustand: er
     * laeuft die angegebene Zahl von Malen und hoert dann auf.
     */
    public static void pochen(final View ansicht, int male) {
        if (ansicht == null) return;
        long dauer = dauer(ansicht.getContext(), LANG);
        if (dauer <= 0 || !weiteWege(ansicht.getContext())) return;
        ValueAnimator lauf = ValueAnimator.ofFloat(1f, 1.06f);
        lauf.setDuration(dauer * 2);
        lauf.setRepeatCount(Math.max(0, male * 2 - 1));
        lauf.setRepeatMode(ValueAnimator.REVERSE);
        lauf.setInterpolator(kurve());
        lauf.addUpdateListener(s -> {
            float wert = (float) s.getAnimatedValue();
            ansicht.setScaleX(wert);
            ansicht.setScaleY(wert);
        });
        lauf.addListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator wer) {
                ansicht.setScaleX(1f);
                ansicht.setScaleY(1f);
            }
        });
        lauf.start();
    }

    /**
     * Ein kurzes Gelingen: aus dem Nichts heraus ueber die Groesse hinaus und
     * zurueck.
     *
     * <p>Fuer das Herz in der Merkliste und den Haken nach einer Aktion. Der
     * Unterschied zum Pochen ist die Feder - hier soll es sich anfuehlen wie
     * ein Zuschnappen, nicht wie ein Puls.
     */
    public static void gelungen(View ansicht) {
        if (ansicht == null) return;
        long dauer = dauer(ansicht.getContext(), LANG);
        if (dauer <= 0 || !weiteWege(ansicht.getContext())) return;
        ansicht.animate().cancel();
        ansicht.setScaleX(0.7f);
        ansicht.setScaleY(0.7f);
        ansicht.animate().scaleX(1f).scaleY(1f)
            .setDuration(dauer + 100L).setInterpolator(feder(0.85f)).start();
    }

    /**
     * Einen Bereich auf- oder zuklappen: Hoehe und Deckkraft zusammen.
     *
     * <p>Eine der zwei Stellen, an denen eine Groesse wandert - beim
     * Aufklappen ist die Groesse die Aussage. Gemessen wird einmal am Anfang,
     * nicht in jedem Bild.
     */
    public static void klappen(final View bereich, final boolean auf, final Runnable danach) {
        if (bereich == null) {
            if (danach != null) danach.run();
            return;
        }
        long dauer = dauer(bereich.getContext(), LANG);
        if (dauer <= 0) {
            bereich.setAlpha(1f);
            bereich.setVisibility(auf ? View.VISIBLE : View.GONE);
            if (danach != null) danach.run();
            return;
        }
        final ViewGroup.LayoutParams masse = bereich.getLayoutParams();
        if (masse == null) {
            bereich.setVisibility(auf ? View.VISIBLE : View.GONE);
            if (danach != null) danach.run();
            return;
        }
        if (auf) {
            bereich.setVisibility(View.VISIBLE);
            int breite = bereich.getWidth() > 0
                ? bereich.getWidth()
                : bereich.getResources().getDisplayMetrics().widthPixels;
            bereich.measure(
                View.MeasureSpec.makeMeasureSpec(breite, View.MeasureSpec.AT_MOST),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            final int voll = Math.max(1, bereich.getMeasuredHeight());
            bereich.setAlpha(0f);
            final ValueAnimator lauf = ValueAnimator.ofInt(0, voll);
            lauf.setDuration(dauer);
            lauf.setInterpolator(hinein());
            lauf.addUpdateListener(s -> {
                masse.height = (int) s.getAnimatedValue();
                bereich.setLayoutParams(masse);
                bereich.setAlpha(Math.min(1f, lauf.getAnimatedFraction() * 1.6f));
            });
            lauf.addListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator wer) {
                    masse.height = ViewGroup.LayoutParams.WRAP_CONTENT;
                    bereich.setLayoutParams(masse);
                    bereich.setAlpha(1f);
                    if (danach != null) danach.run();
                }
            });
            lauf.start();
        } else {
            final int voll = Math.max(1, bereich.getHeight());
            final ValueAnimator lauf = ValueAnimator.ofInt(voll, 0);
            lauf.setDuration(dauer);
            lauf.setInterpolator(hinaus());
            lauf.addUpdateListener(s -> {
                masse.height = (int) s.getAnimatedValue();
                bereich.setLayoutParams(masse);
                bereich.setAlpha(1f - lauf.getAnimatedFraction());
            });
            lauf.addListener(new AnimatorListenerAdapter() {
                @Override
                public void onAnimationEnd(Animator wer) {
                    bereich.setVisibility(View.GONE);
                    masse.height = ViewGroup.LayoutParams.WRAP_CONTENT;
                    bereich.setLayoutParams(masse);
                    bereich.setAlpha(1f);
                    if (danach != null) danach.run();
                }
            });
            lauf.start();
        }
    }

    /**
     * Eine Leiste faehrt von oben oder unten herein - oder wieder hinaus.
     *
     * <p>Fuer die Bedienleisten des Spielers. Der Weg ist die eigene Hoehe der
     * Leiste, damit sie wirklich hinter der Kante verschwindet und nicht nur
     * blass wird.
     *
     * @param vonOben ob die Leiste oben haengt; sonst unten
     */
    public static void leiste(final View leiste, final boolean herein, final boolean vonOben) {
        if (leiste == null) return;
        long dauer = dauer(leiste.getContext(), LANG);
        int hoehe = leiste.getHeight();
        if (dauer <= 0 || hoehe <= 0) {
            leiste.animate().cancel();
            leiste.setTranslationY(0f);
            leiste.setAlpha(herein ? 1f : 0f);
            leiste.setVisibility(herein ? View.VISIBLE : View.GONE);
            return;
        }
        float weg = vonOben ? -hoehe : hoehe;
        if (herein) {
            leiste.setVisibility(View.VISIBLE);
            leiste.setTranslationY(weg);
            leiste.setAlpha(0f);
            leiste.animate().translationY(0f).alpha(1f)
                .setDuration(dauer).setInterpolator(hinein()).withLayer().start();
        } else {
            leiste.animate().translationY(weg).alpha(0f)
                .setDuration(dauer).setInterpolator(hinaus()).withLayer()
                .withEndAction(() -> {
                    leiste.setVisibility(View.GONE);
                    leiste.setTranslationY(0f);
                    leiste.setAlpha(1f);
                })
                .start();
        }
    }
}
