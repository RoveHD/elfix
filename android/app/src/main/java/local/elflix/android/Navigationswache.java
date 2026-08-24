package local.elflix.android;

/**
 * Wer den Hauptrahmen bekommt - und was passiert, wenn ihn niemand bekommen darf.
 *
 * <p><b>Woran es lag.</b> Bis hierher hat {@code onCreateWindow} bei jedem
 * Hoster-Klick ein Budget von vier Spruengen gesetzt, und
 * {@code shouldOverrideUrlLoading} hat dieses Budget <em>vor</em> jeder Pruefung
 * des Ziels verbraucht. Die naechsten vier Hauptnavigationen gingen damit
 * ueberallhin durch - auch die der Werbeskripte, die auf einer AniWorld-
 * Episodenseite genau in diesem Augenblick feuern. Gesperrt wurde erst, als das
 * Budget mitten in der Werbekette leer war. Da war die Folgenseite schon
 * mehrere Navigationen her; abgebrochen wurde eine Kette, deren letztes
 * bestaetigtes Dokument eine leere Werbe-Weiche war. Genau in dieser
 * Reihenfolge sah es der Benutzer: erst "Weiterleitung blockiert", dann weiss.
 *
 * <p><b>Was sich aendert.</b> Das Budget bleibt - ohne es geht der Hoster nicht
 * auf, denn dessen zweiter Sprung kommt vom Skript und nicht vom Server
 * ({@code isRedirect()} ist dort {@code false}, gemessen:
 * {@code voe.sx -> nicolehappyoutside.com}). Es gilt aber nur noch fuer
 * Spruenge, die wirklich zu einer solchen Kette gehoeren koennen:
 *
 * <ul>
 *   <li>eine Weiterleitung des Servers ({@code isRedirect()}), oder
 *   <li>ein Sprung aus einem Dokument heraus, das gar nicht mehr dem Anbieter
 *       gehoert - also aus der Kette selbst.
 * </ul>
 *
 * Der Werbesprung von der Episodenseite ist keines von beidem: er kommt vom
 * Skript und geht von einer Seite des Anbieters aus. Er kann das Budget also
 * weder benutzen noch aufbrauchen, und er wird gesperrt, <em>solange AniWorld
 * noch dasteht</em>. Das ist der ganze Unterschied zwischen "die Seite bleibt"
 * und "die Seite ist weg".
 *
 * <p>Zusaetzlich laeuft das Budget nach {@link #BUDGET_GUELTIG_MS} ab. Eine
 * Kette ist in Sekunden durch; was zwei Minuten spaeter losspringt, ist keine.
 *
 * <p><b>Und wenn doch.</b> Eine Sperre darf nie das Letzte sein, was passiert:
 * steht der Hauptrahmen danach auf nichts Gueltigem, sagt
 * {@link #istGestrandet}, dass zurueckgeholt werden muss. Ohne das waere jede
 * kuenftige Luecke wieder eine weisse Seite.
 *
 * <p>Bewusst ohne Android darin: {@code Uri}, {@code WebView} und
 * {@code Toast} gibt es auf einer nackten JVM nicht, und eine Regel, die man
 * nur auf einem Geraet ausprobieren kann, wird nicht ausprobiert. Siehe
 * {@code android/navigationsprobe/NavigationsProbe.java}.
 */
public final class Navigationswache {

    /** Wieviele Spruenge eine geoeffnete Hoster-Weiche hoechstens braucht. */
    public static final int BUDGET_SPRUENGE = 4;
    /** Wie lange sie sie brauchen darf. Danach ist es keine Kette mehr. */
    public static final long BUDGET_GUELTIG_MS = 30_000L;
    /** Wie lange eine von ELFIX selbst gewaehlte Adresse ihren Freifahrtschein behaelt. */
    public static final long SELBST_GUELTIG_MS = 30_000L;
    /** Derselbe Wirt loest innerhalb dieser Spanne keine zweite Meldung aus. */
    public static final long MELDUNG_WIRT_MS = 15_000L;
    /** Und ueberhaupt keine zwei Meldungen dichter als das. */
    public static final long MELDUNG_ABSTAND_MS = 3_000L;
    /** Kuerzester Abstand zwischen zwei Rettungen - gegen jede Art von Schleife. */
    public static final long RETTUNG_ABSTAND_MS = 5_000L;

    /** Das Urteil ueber eine Hauptnavigation, samt dem Grund dafuer. */
    public static final class Urteil {
        public final boolean erlaubt;
        /** Kurzwort fuer das Protokoll: "selbst", "erstpartei", "weiche", "kette", "werbung". */
        public final String grund;

        Urteil(boolean erlaubt, String grund) {
            this.erlaubt = erlaubt;
            this.grund = grund;
        }

        @Override
        public String toString() {
            return (erlaubt ? "erlaubt" : "blockiert") + "/" + grund;
        }
    }

    private static final Urteil SELBST = new Urteil(true, "selbst");
    private static final Urteil ERSTPARTEI = new Urteil(true, "erstpartei");
    private static final Urteil WEICHE = new Urteil(true, "weiche");
    private static final Urteil KETTE = new Urteil(true, "kette");
    private static final Urteil WERBUNG = new Urteil(false, "werbung");

    private String selbstAdresse;
    private long selbstBis;
    private int budget;
    private long budgetBis;

    /**
     * Wann welcher Wirt zuletzt gemeldet wurde.
     *
     * <p>Ein einzelnes "zuletzt gemeldet" reichte nicht: eine Werbekette
     * wechselt den Wirt bei jedem Sprung, und dann faellt jeder von ihnen
     * abwechselnd wieder aus der Sperre heraus - genau der Toast-Schwall, den
     * die Bremse verhindern soll. Die Karte ist nach oben begrenzt; mehr als
     * eine Handvoll Wirte gibt eine Kette nicht her, und was herausfaellt, ist
     * ohnehin laengst abgelaufen.
     */
    private final java.util.LinkedHashMap<String, Long> meldungJeWirt =
        new java.util.LinkedHashMap<String, Long>(16, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(java.util.Map.Entry<String, Long> aeltester) {
                return size() > 32;
            }
        };
    /** Ob ueberhaupt schon einmal gemeldet wurde - sonst waere die erste Meldung "zu frueh". */
    private boolean schonGemeldet;
    private long letzteMeldungAt;
    private boolean schonGerettet;
    private long letzteRettungAt;

    /**
     * Was von einer Hauptnavigation zu halten ist.
     *
     * @param zielErstpartei   gehoert das Ziel dem Anbieter selbst
     * @param quelleErstpartei steht der Hauptrahmen gerade noch beim Anbieter
     * @param istWeiterleitung sagt der Server die Navigation an (302 und Verwandte)
     */
    public Urteil hauptnavigation(String zielUrl, boolean zielErstpartei,
            boolean quelleErstpartei, boolean istWeiterleitung, long jetzt) {
        // 1. Was ELFIX selbst geladen hat, kommt durch - genau einmal.
        if (zielUrl != null && zielUrl.equals(selbstAdresse) && jetzt <= selbstBis) {
            selbstAdresse = null;
            return SELBST;
        }
        // 2. Der Anbieter selbst: Startseite, Suche, Serie, Staffel, Folge, Anmeldung.
        if (zielErstpartei) return ERSTPARTEI;
        // 3. Der Server des Anbieters schickt weiter - das ist seine Hoster-Weiche
        //    (AniWorlds /redirect/<id>). Werbung kommt hier nicht durch: ihre
        //    Spruenge kommen aus dem Skript und tragen isRedirect()=false.
        if (istWeiterleitung && quelleErstpartei) {
            budgetGeben(jetzt);
            return WEICHE;
        }
        // 4. Die Kette danach - aber nur, wenn es eine sein kann. Ein Sprung aus
        //    einer Seite des Anbieters heraus, den kein Server angesagt hat, ist
        //    keine Kette, sondern die Werbung. Genau hier lag der Fehler.
        if (budget > 0 && jetzt <= budgetBis && (istWeiterleitung || !quelleErstpartei)) {
            budget -= 1;
            return KETTE;
        }
        return WERBUNG;
    }

    /** ELFIX laedt diese Adresse gleich selbst; sie soll sich nicht selbst sperren. */
    public void selbstGewaehlt(String url, long jetzt) {
        selbstAdresse = url;
        selbstBis = jetzt + SELBST_GUELTIG_MS;
    }

    /** Ein Popup, das auf einen Hoster zeigt, oeffnet dieselbe Kette wie die Weiche. */
    public void ketteEroeffnen(long jetzt) {
        budgetGeben(jetzt);
    }

    private void budgetGeben(long jetzt) {
        budget = BUDGET_SPRUENGE;
        budgetBis = jetzt + BUDGET_GUELTIG_MS;
    }

    /** Eine bewusste Navigation von ELFIX beendet jede noch laufende Kette. */
    public void zuruecksetzen() {
        budget = 0;
        budgetBis = 0;
        selbstAdresse = null;
        selbstBis = 0;
    }

    public int offenesBudget(long jetzt) {
        return jetzt <= budgetBis ? budget : 0;
    }

    /**
     * Steht der Hauptrahmen nach der Sperre noch auf etwas Brauchbarem?
     *
     * <p>Der uebliche Fall ist, dass er es tut: die Werbung wurde abgebrochen,
     * bevor ihr Dokument bestaetigt war, und die Folgenseite steht unveraendert
     * da. Dann ist nichts zu tun - eine Rettung waere dort selbst das Problem,
     * weil sie eine Seite neu laedt, die niemand angefasst hat.
     *
     * <p><b>Warum die Frage so eng gestellt ist.</b> Naheliegend waere gewesen,
     * auch "gehoert weder dem Anbieter noch einem Hoster" als gestrandet zu
     * zaehlen. Das haette den laufenden Film abgeschossen: der Hoster liegt zu
     * dieser Zeit auf einer rotierenden Wegwerf-Adresse - gemessen
     * {@code nicolehappyoutside.com/e/<id>} -, und die traegt weder einen
     * Hosternamen noch einen der bekannten Pfade. Nach dieser Regel waere jede
     * gesperrte Werbung <em>waehrend</em> des Films ein Rueckwurf auf die
     * Folgenseite gewesen. Eine Seite, die geladen hat, ist eine Seite; nur wo
     * gar kein Dokument steht, ist wirklich nichts zu sehen.
     */
    public static boolean istGestrandet(String aktuellUrl) {
        if (aktuellUrl == null) return true;
        String adresse = aktuellUrl.trim().toLowerCase();
        if (adresse.isEmpty()) return true;
        if (adresse.startsWith("about:") || adresse.startsWith("data:")) return true;
        return !adresse.startsWith("http://") && !adresse.startsWith("https://");
    }

    /** Damit zwei Rettungen einander nicht hochschaukeln. */
    public boolean rettungFaellig(long jetzt) {
        if (schonGerettet && jetzt - letzteRettungAt < RETTUNG_ABSTAND_MS) return false;
        schonGerettet = true;
        letzteRettungAt = jetzt;
        return true;
    }

    /**
     * Ob diese Sperre gemeldet werden soll.
     *
     * <p>Eine Werbekette versucht es nicht einmal, sondern in Schueben. Ohne
     * diese Bremse stuenden fuenf Meldungen uebereinander, und die eine, die
     * etwas erklaert, ginge darin unter.
     */
    public boolean meldungFaellig(String wirt, long jetzt) {
        String name = wirt == null ? "" : wirt;
        Long zuletzt = meldungJeWirt.get(name);
        if (zuletzt != null && jetzt - zuletzt < MELDUNG_WIRT_MS) return false;
        if (schonGemeldet && jetzt - letzteMeldungAt < MELDUNG_ABSTAND_MS) return false;
        meldungJeWirt.put(name, jetzt);
        schonGemeldet = true;
        letzteMeldungAt = jetzt;
        return true;
    }
}
